-- Private-bid leaderboard, Buy Now, and per-round results history.

-- ------------------------------------------------------------- columns
alter table public.auction_sessions
  add column if not exists buy_now_price integer
    check (buy_now_price is null or buy_now_price between 1 and 1000000),
  add column if not exists bought_now boolean not null default false;

-- ------------------------------------------------------ rounds history
-- One row per finished round, written by a trigger at the moment a round
-- stops being open, whichever code path closed it (expiry, host stop,
-- Buy Now, or the next round starting over an expired one).
create table if not exists public.auction_rounds (
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  round_no integer not null,
  item_name text not null,
  opening_bid integer not null,
  reserve_price integer,
  buy_now_price integer,
  final_bid integer not null,
  winner_key text,
  winner_name text,
  winner_verified boolean,
  bid_count integer not null,
  outcome text not null check (outcome in ('sold', 'reserve_not_met', 'no_bids')),
  bought_now boolean not null default false,
  closed_at timestamptz not null,
  primary key (session_uuid, round_no)
);
alter table public.auction_rounds enable row level security;
revoke all on public.auction_rounds from anon, authenticated;
grant select, insert, update, delete on public.auction_rounds to service_role;

create or replace function public.record_round()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.auction_sessions%rowtype;
  v_count integer;
  v_verified boolean;
begin
  -- Closed in place: the new row holds the final values. Replaced by a new
  -- round without ever being closed: the old row does.
  if new.round_no = old.round_no then r := new; else r := old; end if;

  select count(*) into v_count
    from public.auction_bids where session_uuid = r.uuid and round_no = r.round_no;
  select verified into v_verified
    from public.auction_bids where session_uuid = r.uuid and round_no = r.round_no
   order by id desc limit 1;

  insert into public.auction_rounds
    (session_uuid, round_no, item_name, opening_bid, reserve_price, buy_now_price,
     final_bid, winner_key, winner_name, winner_verified, bid_count, outcome,
     bought_now, closed_at)
  values
    (r.uuid, r.round_no, r.item_name, r.opening_bid, r.reserve_price, r.buy_now_price,
     r.current_bid, r.last_bidder_id, r.last_bidder_name, v_verified, v_count,
     case
       when r.last_bidder_id is null then 'no_bids'
       when r.reserve_price is not null and r.current_bid < r.reserve_price then 'reserve_not_met'
       else 'sold'
     end,
     r.bought_now, coalesce(r.closed_at, r.ends_at, now()))
  on conflict (session_uuid, round_no) do nothing;
  return null;
end;
$$;

drop trigger if exists auction_sessions_record_round on public.auction_sessions;
create trigger auction_sessions_record_round
  after update on public.auction_sessions
  for each row
  when (old.status = 'open' and (new.status <> 'open' or new.round_no <> old.round_no))
  execute function public.record_round();

-- --------------------------------------------------------- leaderboard
-- One entry per bidder for a round, best bid first. Amounts are included
-- only for the server (p_amounts); the copy that goes out on the realtime
-- topic never carries them.
create or replace function public.round_leaderboard(p_uuid text, p_round integer, p_amounts boolean)
returns jsonb
language sql stable set search_path = public as $$
  select coalesce(
    jsonb_agg(case when p_amounts then x.e else x.e - 'amount' end order by x.best desc),
    '[]'::jsonb)
  from (
    select max(amount) as best,
           jsonb_build_object(
             'bidder_key', bidder_key,
             'bidder_name', (array_agg(bidder_name order by id desc))[1],
             'verified', bool_or(verified),
             'amount', max(amount),
             'bids', count(*),
             'last_bid_at', max(created_at)
           ) as e
      from public.auction_bids
     where session_uuid = p_uuid and round_no = p_round
     group by bidder_key
     order by max(amount) desc
     limit 50
  ) x;
$$;

revoke execute on function public.round_leaderboard(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.round_leaderboard(text, integer, boolean) to service_role;

-- State for the API: session + leaderboard with amounts (the API decides
-- which amounts each viewer may see) + server clock. No raw bid ledger.
create or replace function public.session_state(p_uuid text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
begin
  update public.auction_sessions
     set status = 'closed', closed_at = ends_at, updated_at = clock_timestamp()
   where uuid = p_uuid and status = 'open' and ends_at <= now();

  select * into s from public.auction_sessions where uuid = p_uuid;
  if not found then return null; end if;

  return jsonb_build_object(
    'session', to_jsonb(s),
    'leaderboard', public.round_leaderboard(p_uuid, s.round_no, true),
    -- Empty ledger kept for API builds deployed before this migration.
    'bids', '[]'::jsonb,
    'server_now', now());
end;
$$;

-- Session broadcasts carry the public leaderboard (ranks, no amounts), so
-- clients re-rank on push without a read. Individual bids are no longer
-- broadcast at all: their amounts are private.
create or replace function public.broadcast_session_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_record jsonb;
begin
  v_record := (to_jsonb(new) - 'host_key')
    || jsonb_build_object('host_key', case when new.host_key is null then null else 'claimed' end);
  perform realtime.send(
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'operation', TG_OP,
      'record', v_record,
      'leaderboard', public.round_leaderboard(new.uuid, new.round_no, false)
    ),
    TG_OP,
    'session:' || new.uuid,
    true
  );
  return null;
end;
$$;

drop trigger if exists auction_bids_broadcast on public.auction_bids;
drop function if exists public.broadcast_bid_insert();

-- ---------------------------------------------------------- start_round
-- Adds p_buy_now (defaulted, so callers that omit it keep working).
drop function if exists public.start_round(text, text, text, integer, integer, integer, integer, integer);

create or replace function public.start_round(
  p_uuid text, p_host_key text, p_item text, p_opening integer,
  p_reserve integer, p_seconds integer, p_extend_window integer, p_extend_by integer,
  p_buy_now integer default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_stale boolean;
  v_takeover boolean;
begin
  if p_seconds < 5 or p_seconds > 3600 then
    return jsonb_build_object('ok', false, 'reason', 'bad_seconds');
  end if;
  -- Buy Now must be reachable by bidding (above the opening price) and can
  -- never sell below the reserve.
  if p_buy_now is not null and (
       p_buy_now <= p_opening or p_buy_now > 1000000
       or (p_reserve is not null and p_buy_now < p_reserve)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_buy_now');
  end if;
  if p_uuid like 'mtg-%' and p_host_key is null then
    return jsonb_build_object('ok', false, 'reason', 'unverified');
  end if;

  insert into public.auction_sessions (uuid) values (p_uuid) on conflict (uuid) do nothing;
  select * into s from public.auction_sessions where uuid = p_uuid for update;

  v_stale := s.status <> 'open' and s.updated_at < now() - interval '2 hours';
  if s.host_key is not null and s.host_key is distinct from p_host_key and not v_stale then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if s.status = 'open' and s.ends_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'round_open', 'session', to_jsonb(s));
  end if;

  v_takeover := p_uuid like 'mtg-%' and s.host_key is distinct from p_host_key;

  update public.auction_sessions
     set host_key = case when p_uuid like 'mtg-%' then p_host_key else null end,
         host_verified = case when v_takeover then false else s.host_verified end,
         round_no = s.round_no + 1,
         item_name = p_item,
         opening_bid = p_opening,
         current_bid = p_opening,
         last_bidder_id = null,
         last_bidder_name = null,
         reserve_price = p_reserve,
         buy_now_price = p_buy_now,
         bought_now = false,
         ends_at = now() + make_interval(secs => p_seconds),
         closed_at = null,
         extend_window_seconds = p_extend_window,
         extend_by_seconds = p_extend_by,
         status = 'open',
         updated_at = clock_timestamp()
   where uuid = p_uuid
   returning * into s;

  return jsonb_build_object('ok', true, 'session', to_jsonb(s));
end;
$$;

revoke execute on function public.start_round(text, text, text, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.start_round(text, text, text, integer, integer, integer, integer, integer, integer) to service_role;

-- ------------------------------------------------------------ place_bid
-- Two changes. The bid row is written before the session row, so the
-- session triggers (broadcast, round record) already see it. And a bid at
-- or above the Buy Now price is accepted at exactly that price and closes
-- the round in the same locked transaction: a second buyer arriving in the
-- same instant finds the round closed.
create or replace function public.place_bid(
  p_uuid text, p_amount integer, p_bidder_key text, p_bidder_name text, p_verified boolean
) returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_now timestamptz := now();
  v_min integer;
  v_amount integer := p_amount;
  v_ends timestamptz;
  v_extended boolean := false;
  v_bought boolean := false;
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
  if s.buy_now_price is not null and p_amount >= s.buy_now_price then
    v_amount := s.buy_now_price;
    v_bought := true;
  end if;

  -- First bid may equal the opening price; later bids must beat the leader.
  v_min := case when s.last_bidder_id is null then s.current_bid else s.current_bid + 1 end;
  if v_amount < v_min then
    return jsonb_build_object('ok', false, 'reason', 'too_low', 'min_amount', v_min, 'session', to_jsonb(s));
  end if;

  insert into public.auction_bids
    (session_uuid, round_no, amount, bidder_key, bidder_name, verified, created_at)
  values (p_uuid, s.round_no, v_amount, p_bidder_key, p_bidder_name, p_verified, clock_timestamp())
  returning id into v_bid_id;

  if v_bought then
    update public.auction_sessions
       set current_bid = v_amount,
           last_bidder_id = p_bidder_key,
           last_bidder_name = p_bidder_name,
           bought_now = true,
           status = 'closed',
           closed_at = clock_timestamp(),
           ends_at = least(ends_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where uuid = p_uuid
     returning * into s;
  else
    -- Anti-snipe: a bid inside the closing window pushes the clock out, and
    -- never backwards (colliding extensions keep the latest deadline).
    v_ends := s.ends_at;
    if s.ends_at - v_now < make_interval(secs => s.extend_window_seconds) then
      v_ends := greatest(s.ends_at, v_now + make_interval(secs => s.extend_by_seconds));
      v_extended := v_ends > s.ends_at;
    end if;

    update public.auction_sessions
       set current_bid = v_amount,
           last_bidder_id = p_bidder_key,
           last_bidder_name = p_bidder_name,
           ends_at = v_ends,
           updated_at = clock_timestamp()
     where uuid = p_uuid
     returning * into s;
  end if;

  return jsonb_build_object('ok', true, 'extended', v_extended, 'bought', v_bought,
                            'amount', v_amount, 'bid_id', v_bid_id, 'session', to_jsonb(s));
end;
$$;

notify pgrst, 'reload schema';
