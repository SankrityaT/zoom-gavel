-- A queue of lots the host lines up in advance, and max bids: a bidder
-- names the most they will pay and the server bids for them up to it.

-- =============================================================== queue
alter table public.auction_sessions
  add column if not exists queue_count integer not null default 0,
  add column if not exists queue_next text;

create table if not exists public.auction_queue (
  id bigserial primary key,
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  item_name text not null,
  opening_bid integer not null check (opening_bid between 0 and 1000000),
  reserve_price integer check (reserve_price is null or reserve_price between 0 and 1000000),
  buy_now_price integer check (buy_now_price is null or buy_now_price between 1 and 1000000),
  seconds integer not null check (seconds between 5 and 3600),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists auction_queue_session_idx on public.auction_queue (session_uuid, id);
alter table public.auction_queue enable row level security;
revoke all on public.auction_queue from anon, authenticated;
grant select, insert, update, delete on public.auction_queue to service_role;
grant usage, select on sequence public.auction_queue_id_seq to service_role;

-- The host rule start_round applies, for the queue: locks the session row
-- (creating it if needed) and returns null when p_host_key may act, or the
-- refusal reason. An unclaimed meeting session is claimed by the caller.
create or replace function public.host_gate(p_uuid text, p_host_key text)
returns text
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_stale boolean;
begin
  if p_uuid like 'mtg-%' and p_host_key is null then
    return 'unverified';
  end if;
  insert into public.auction_sessions (uuid) values (p_uuid) on conflict (uuid) do nothing;
  select * into s from public.auction_sessions where uuid = p_uuid for update;

  v_stale := s.status <> 'open' and s.updated_at < now() - interval '2 hours';
  if s.host_key is not null and s.host_key is distinct from p_host_key and not v_stale then
    return 'not_host';
  end if;
  if p_uuid like 'mtg-%' and s.host_key is distinct from p_host_key then
    update public.auction_sessions
       set host_key = p_host_key, host_verified = false
     where uuid = p_uuid;
  end if;
  return null;
end;
$$;

-- Keeps the two queue facts everyone may see (how many lots wait, and the
-- next one's name) on the session row, so they ride the normal broadcast.
create or replace function public.queue_refresh(p_uuid text)
returns void
language sql set search_path = public as $$
  update public.auction_sessions
     set queue_count = (select count(*) from public.auction_queue where session_uuid = p_uuid),
         queue_next = (select item_name from public.auction_queue where session_uuid = p_uuid order by id limit 1),
         updated_at = clock_timestamp()
   where uuid = p_uuid;
$$;

create or replace function public.queue_list(p_uuid text)
returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb)
    from (select id, item_name, opening_bid, reserve_price, buy_now_price, seconds
            from public.auction_queue where session_uuid = p_uuid order by id) q;
$$;

create or replace function public.queue_add(
  p_uuid text, p_host_key text, p_item text, p_opening integer,
  p_reserve integer, p_buy_now integer, p_seconds integer
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_reason text;
begin
  if p_seconds < 5 or p_seconds > 3600 then
    return jsonb_build_object('ok', false, 'reason', 'bad_seconds');
  end if;
  if p_buy_now is not null and (
       p_buy_now <= p_opening or p_buy_now > 1000000
       or (p_reserve is not null and p_buy_now < p_reserve)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_buy_now');
  end if;
  v_reason := public.host_gate(p_uuid, p_host_key);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  if (select count(*) from public.auction_queue where session_uuid = p_uuid) >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'queue_full');
  end if;

  insert into public.auction_queue (session_uuid, item_name, opening_bid, reserve_price, buy_now_price, seconds)
  values (p_uuid, p_item, p_opening, p_reserve, p_buy_now, p_seconds);
  perform public.queue_refresh(p_uuid);
  return jsonb_build_object('ok', true, 'queue', public.queue_list(p_uuid));
end;
$$;

create or replace function public.queue_remove(p_uuid text, p_host_key text, p_id bigint)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_reason text;
begin
  v_reason := public.host_gate(p_uuid, p_host_key);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  delete from public.auction_queue where session_uuid = p_uuid and id = p_id;
  perform public.queue_refresh(p_uuid);
  return jsonb_build_object('ok', true, 'queue', public.queue_list(p_uuid));
end;
$$;

-- Starts the first queued lot as a round and takes it off the queue, in one
-- transaction: two taps at once cannot start the same lot twice or skip one.
create or replace function public.queue_start_next(
  p_uuid text, p_host_key text, p_extend_window integer, p_extend_by integer
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_reason text;
  q public.auction_queue%rowtype;
  r jsonb;
  s public.auction_sessions%rowtype;
begin
  v_reason := public.host_gate(p_uuid, p_host_key);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  select * into q from public.auction_queue where session_uuid = p_uuid order by id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'queue_empty');
  end if;

  r := public.start_round(p_uuid, p_host_key, q.item_name, q.opening_bid, q.reserve_price,
                          q.seconds, p_extend_window, p_extend_by, q.buy_now_price);
  if not (r->>'ok')::boolean then
    return r;
  end if;
  delete from public.auction_queue where id = q.id;
  perform public.queue_refresh(p_uuid);
  select * into s from public.auction_sessions where uuid = p_uuid;
  return jsonb_build_object('ok', true, 'session', to_jsonb(s), 'queue', public.queue_list(p_uuid));
end;
$$;

-- ============================================================ max bids
-- One ceiling per bidder per round. Never broadcast and never returned to
-- anyone but its owner.
create table if not exists public.auction_max_bids (
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  round_no integer not null,
  bidder_key text not null,
  bidder_name text not null,
  verified boolean not null default false,
  max_amount integer not null check (max_amount between 0 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_uuid, round_no, bidder_key)
);
alter table public.auction_max_bids enable row level security;
revoke all on public.auction_max_bids from anon, authenticated;
grant select, insert, update, delete on public.auction_max_bids to service_role;

alter table public.auction_bids
  add column if not exists auto boolean not null default false;

-- Records one accepted bid: the ledger row first (so the session triggers
-- already see it), then the session, with the anti-snipe extension. The
-- caller holds the row lock and has checked the amount. Returns whether the
-- clock was extended.
create or replace function public.apply_bid(
  p_uuid text, p_amount integer, p_bidder_key text, p_bidder_name text,
  p_verified boolean, p_auto boolean
) returns boolean
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_now timestamptz := now();
  v_ends timestamptz;
begin
  select * into s from public.auction_sessions where uuid = p_uuid;

  insert into public.auction_bids
    (session_uuid, round_no, amount, bidder_key, bidder_name, verified, auto, created_at)
  values (p_uuid, s.round_no, p_amount, p_bidder_key, p_bidder_name, p_verified, p_auto, clock_timestamp());

  -- Anti-snipe: a bid inside the closing window pushes the clock out, and
  -- never backwards (colliding extensions keep the latest deadline).
  v_ends := s.ends_at;
  if s.ends_at - v_now < make_interval(secs => s.extend_window_seconds) then
    v_ends := greatest(s.ends_at, v_now + make_interval(secs => s.extend_by_seconds));
  end if;

  update public.auction_sessions
     set current_bid = p_amount,
         last_bidder_id = p_bidder_key,
         last_bidder_name = p_bidder_name,
         ends_at = v_ends,
         updated_at = clock_timestamp()
   where uuid = p_uuid;

  return v_ends > s.ends_at;
end;
$$;

-- Lets the max bids fight it out after any change, the way a live auction
-- house does it: the highest ceiling leads, at one step above the next
-- highest (or at its own ceiling if that is lower). A tie goes to whoever
-- already leads. Every loop strictly raises the price or uses up a
-- challenger, so it ends; the cap is a backstop.
create or replace function public.resolve_max_bids(p_uuid text)
returns integer
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  c public.auction_max_bids%rowtype;
  v_lead_max integer;
  v_lead_verified boolean;
  v_amount integer;
  v_step constant integer := 25;
  v_placed integer := 0;
begin
  for i in 1 .. 200 loop
    select * into s from public.auction_sessions where uuid = p_uuid;
    exit when s.status <> 'open';

    select * into c
      from public.auction_max_bids
     where session_uuid = p_uuid and round_no = s.round_no
       and bidder_key is distinct from s.last_bidder_id
       and (max_amount > s.current_bid or (s.last_bidder_id is null and max_amount >= s.current_bid))
     order by max_amount desc, created_at asc
     limit 1;
    exit when not found;

    if s.last_bidder_id is null then
      -- Nobody has bid: the challenger opens at the opening price.
      perform public.apply_bid(p_uuid, s.current_bid, c.bidder_key, c.bidder_name, c.verified, true);
    else
      select max_amount, verified into v_lead_max, v_lead_verified
        from public.auction_max_bids
       where session_uuid = p_uuid and round_no = s.round_no and bidder_key = s.last_bidder_id;
      v_lead_max := greatest(coalesce(v_lead_max, s.current_bid), s.current_bid);

      if c.max_amount > v_lead_max then
        v_amount := least(c.max_amount, v_lead_max + v_step);
        perform public.apply_bid(p_uuid, v_amount, c.bidder_key, c.bidder_name, c.verified, true);
      else
        -- The leader's ceiling covers the challenger: the leader's bid rises
        -- just far enough to stay ahead.
        v_amount := least(v_lead_max, c.max_amount + v_step);
        exit when v_amount <= s.current_bid;
        perform public.apply_bid(p_uuid, v_amount, s.last_bidder_id, s.last_bidder_name,
                                 coalesce(v_lead_verified, false), true);
      end if;
    end if;
    v_placed := v_placed + 1;
  end loop;
  return v_placed;
end;
$$;

-- place_bid, now built on apply_bid and followed by the max-bid contest.
create or replace function public.place_bid(
  p_uuid text, p_amount integer, p_bidder_key text, p_bidder_name text, p_verified boolean
) returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_now timestamptz := now();
  v_min integer;
  v_extended boolean := false;
  v_bid_id bigint;
begin
  select * into s from public.auction_sessions where uuid = p_uuid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'not_open', 'session', to_jsonb(s));
  end if;
  if s.ends_at <= v_now then
    update public.auction_sessions
       set status = 'closed', closed_at = ends_at, updated_at = clock_timestamp()
     where uuid = p_uuid returning * into s;
    return jsonb_build_object('ok', false, 'reason', 'expired', 'session', to_jsonb(s));
  end if;

  if p_amount > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'over_max', 'session', to_jsonb(s));
  end if;

  -- First bid may equal the opening price; later bids must beat the leader.
  v_min := case when s.last_bidder_id is null then s.current_bid else s.current_bid + 1 end;

  -- At or above the Buy Now price: accepted at exactly that price, and the
  -- round closes in this same locked transaction.
  if s.buy_now_price is not null and p_amount >= s.buy_now_price then
    if s.buy_now_price < v_min then
      return jsonb_build_object('ok', false, 'reason', 'too_low', 'min_amount', v_min, 'session', to_jsonb(s));
    end if;
    insert into public.auction_bids
      (session_uuid, round_no, amount, bidder_key, bidder_name, verified, created_at)
    values (p_uuid, s.round_no, s.buy_now_price, p_bidder_key, p_bidder_name, p_verified, clock_timestamp())
    returning id into v_bid_id;
    update public.auction_sessions
       set current_bid = s.buy_now_price,
           last_bidder_id = p_bidder_key,
           last_bidder_name = p_bidder_name,
           bought_now = true,
           status = 'closed',
           closed_at = clock_timestamp(),
           ends_at = least(ends_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where uuid = p_uuid
     returning * into s;
    return jsonb_build_object('ok', true, 'extended', false, 'bought', true,
                              'amount', s.current_bid, 'bid_id', v_bid_id, 'session', to_jsonb(s));
  end if;

  if p_amount < v_min then
    return jsonb_build_object('ok', false, 'reason', 'too_low', 'min_amount', v_min, 'session', to_jsonb(s));
  end if;

  v_extended := public.apply_bid(p_uuid, p_amount, p_bidder_key, p_bidder_name, p_verified, false);
  -- A hand-placed bid above your own ceiling becomes your new ceiling.
  update public.auction_max_bids
     set max_amount = p_amount
   where session_uuid = p_uuid and round_no = s.round_no
     and bidder_key = p_bidder_key and max_amount < p_amount;
  perform public.resolve_max_bids(p_uuid);

  select * into s from public.auction_sessions where uuid = p_uuid;
  return jsonb_build_object('ok', true, 'extended', v_extended, 'bought', false,
                            'amount', p_amount, 'session', to_jsonb(s));
end;
$$;

-- Sets, changes, or (p_max null) removes a bidder's ceiling for the round.
create or replace function public.set_max_bid(
  p_uuid text, p_bidder_key text, p_bidder_name text, p_verified boolean, p_max integer
) returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_min integer;
begin
  select * into s from public.auction_sessions where uuid = p_uuid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'not_open', 'session', to_jsonb(s));
  end if;
  if s.ends_at <= now() then
    update public.auction_sessions
       set status = 'closed', closed_at = ends_at, updated_at = clock_timestamp()
     where uuid = p_uuid returning * into s;
    return jsonb_build_object('ok', false, 'reason', 'expired', 'session', to_jsonb(s));
  end if;

  if p_max is null then
    delete from public.auction_max_bids
     where session_uuid = p_uuid and round_no = s.round_no and bidder_key = p_bidder_key;
    return jsonb_build_object('ok', true, 'max', null, 'session', to_jsonb(s));
  end if;

  if p_max > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'over_max', 'session', to_jsonb(s));
  end if;
  -- A ceiling at the Buy Now price would be a purchase, not a bid.
  if s.buy_now_price is not null and p_max >= s.buy_now_price then
    return jsonb_build_object('ok', false, 'reason', 'over_buy_now',
                              'max_allowed', s.buy_now_price - 1, 'session', to_jsonb(s));
  end if;
  -- The leader may set any ceiling at or above their own bid; anyone else
  -- needs a ceiling that can actually take the lead.
  v_min := case
    when s.last_bidder_id is null then s.current_bid
    when s.last_bidder_id = p_bidder_key then s.current_bid
    else s.current_bid + 1
  end;
  if p_max < v_min then
    return jsonb_build_object('ok', false, 'reason', 'too_low', 'min_amount', v_min, 'session', to_jsonb(s));
  end if;

  insert into public.auction_max_bids as m
    (session_uuid, round_no, bidder_key, bidder_name, verified, max_amount)
  values (p_uuid, s.round_no, p_bidder_key, p_bidder_name, p_verified, p_max)
  on conflict (session_uuid, round_no, bidder_key) do update
    set max_amount = excluded.max_amount, bidder_name = excluded.bidder_name, verified = excluded.verified;

  perform public.resolve_max_bids(p_uuid);
  select * into s from public.auction_sessions where uuid = p_uuid;
  return jsonb_build_object('ok', true, 'max', p_max, 'session', to_jsonb(s));
end;
$$;

-- session_state gains the viewer's own ceiling (null for anyone else).
drop function if exists public.session_state(text);

create or replace function public.session_state(p_uuid text, p_viewer_key text default null)
returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_max integer;
begin
  update public.auction_sessions
     set status = 'closed', closed_at = ends_at, updated_at = clock_timestamp()
   where uuid = p_uuid and status = 'open' and ends_at <= now();

  select * into s from public.auction_sessions where uuid = p_uuid;
  if not found then return null; end if;

  if p_viewer_key is not null then
    select max_amount into v_max from public.auction_max_bids
     where session_uuid = p_uuid and round_no = s.round_no and bidder_key = p_viewer_key;
  end if;

  return jsonb_build_object(
    'session', to_jsonb(s),
    'leaderboard', public.round_leaderboard(p_uuid, s.round_no, true),
    'viewer_max', v_max,
    'bids', '[]'::jsonb,
    'server_now', now());
end;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public.host_gate(text, text) from public, anon, authenticated;
revoke execute on function public.queue_refresh(text) from public, anon, authenticated;
revoke execute on function public.queue_list(text) from public, anon, authenticated;
revoke execute on function public.queue_add(text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.queue_remove(text, text, bigint) from public, anon, authenticated;
revoke execute on function public.queue_start_next(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.apply_bid(text, integer, text, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.resolve_max_bids(text) from public, anon, authenticated;
revoke execute on function public.set_max_bid(text, text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.session_state(text, text) from public, anon, authenticated;

grant execute on function public.host_gate(text, text) to service_role;
grant execute on function public.queue_refresh(text) to service_role;
grant execute on function public.queue_list(text) to service_role;
grant execute on function public.queue_add(text, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.queue_remove(text, text, bigint) to service_role;
grant execute on function public.queue_start_next(text, text, integer, integer) to service_role;
grant execute on function public.apply_bid(text, integer, text, text, boolean, boolean) to service_role;
grant execute on function public.resolve_max_bids(text) to service_role;
grant execute on function public.set_max_bid(text, text, text, boolean, integer) to service_role;
grant execute on function public.session_state(text, text) to service_role;

notify pgrst, 'reload schema';
