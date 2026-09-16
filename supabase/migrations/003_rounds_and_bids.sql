-- Rounds, host claim, server-authoritative clock with anti-snipe, and a
-- per-bid ledger. All writes still go through service-role functions;
-- clients read via anon key + Realtime.
--
-- Timestamp rule: judgements (expiry, anti-snipe) use now(), the
-- transaction's arrival time. Writes stamp clock_timestamp() so updated_at
-- is strictly increasing across row-lock contenders; the client's
-- monotonic guard depends on that ordering.

-- ---------------------------------------------------------------- sessions
alter table public.auction_sessions
  add column host_key text,
  add column round_no integer not null default 0,
  add column opening_bid integer not null default 0,
  add column reserve_price integer,
  add column last_bidder_name text,
  add column ends_at timestamptz,
  add column closed_at timestamptz,
  add column extend_window_seconds integer not null default 10,
  add column extend_by_seconds integer not null default 15;

-- Existing rows are test data: nothing is biddable until a round starts.
alter table public.auction_sessions drop constraint auction_sessions_status_check;
update public.auction_sessions set status = 'idle' where status = 'open';
alter table public.auction_sessions alter column status set default 'idle';
alter table public.auction_sessions
  add constraint auction_sessions_status_check
    check (status in ('idle', 'open', 'closed')),
  add constraint auction_sessions_open_has_end
    check (status <> 'open' or ends_at is not null),
  add constraint auction_sessions_amount_bounds
    check (opening_bid between 0 and 1000000 and current_bid between 0 and 1000000
           and (reserve_price is null or reserve_price between 0 and 1000000)),
  add constraint auction_sessions_extend_bounds
    check (extend_window_seconds between 0 and 120 and extend_by_seconds between 0 and 300);

-- -------------------------------------------------------------------- bids
create table public.auction_bids (
  id bigserial primary key,
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  round_no integer not null,
  amount integer not null check (amount between 0 and 1000000),
  -- HMAC of the Zoom uid (verified) or of the client id (anon). Never a raw
  -- Zoom uid: this table is publicly readable and in the realtime stream.
  bidder_key text not null,
  bidder_name text not null,
  verified boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index auction_bids_session_round_idx
  on public.auction_bids (session_uuid, round_no, id desc);

alter table public.auction_bids enable row level security;
create policy "bids are publicly readable"
  on public.auction_bids for select to anon, authenticated using (true);

grant select on public.auction_bids to anon, authenticated;
grant select, insert, update, delete on public.auction_bids to service_role;
grant usage, select on sequence public.auction_bids_id_seq to service_role;
alter publication supabase_realtime add table public.auction_bids;

-- ----------------------------------------------------------- old functions
drop function public.place_bid(text, integer, text);
drop function public.ensure_session(text, text, integer);

-- Idempotent bootstrap; new rows are idle (no clock) until start_round.
create or replace function public.ensure_session(
  p_uuid text, p_item text, p_opening integer
) returns jsonb
language sql set search_path = public as $$
  with s as (
    insert into public.auction_sessions (uuid, item_name, opening_bid, current_bid, status)
    values (p_uuid, p_item, p_opening, p_opening, 'idle')
    on conflict (uuid) do update set uuid = excluded.uuid
    returning *
  )
  select to_jsonb(s) from s;
$$;

-- One round trip for pollers: lazily closes an expired round (so Realtime
-- subscribers see the terminal row), then returns session + ladder + clock.
create or replace function public.session_state(p_uuid text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  b jsonb;
begin
  update public.auction_sessions
     set status = 'closed', closed_at = ends_at, updated_at = clock_timestamp()
   where uuid = p_uuid and status = 'open' and ends_at <= now();

  select * into s from public.auction_sessions where uuid = p_uuid;
  if not found then return null; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]'::jsonb) into b
    from (select id, amount, bidder_key, bidder_name, verified, created_at
            from public.auction_bids
           where session_uuid = p_uuid and round_no = s.round_no
           order by id desc limit 50) x;

  return jsonb_build_object('session', to_jsonb(s), 'bids', b, 'server_now', now());
end;
$$;

-- Host claim: first non-null key to start a round owns the session.
-- Meeting sessions (mtg-%) always require a key; sandbox keys never set one.
create or replace function public.start_round(
  p_uuid text, p_host_key text, p_item text, p_opening integer,
  p_reserve integer, p_seconds integer, p_extend_window integer, p_extend_by integer
) returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
begin
  if p_seconds < 5 or p_seconds > 3600 then
    return jsonb_build_object('ok', false, 'reason', 'bad_seconds');
  end if;
  if p_uuid like 'mtg-%' and p_host_key is null then
    return jsonb_build_object('ok', false, 'reason', 'unverified');
  end if;

  insert into public.auction_sessions (uuid) values (p_uuid) on conflict (uuid) do nothing;
  select * into s from public.auction_sessions where uuid = p_uuid for update;

  if s.host_key is not null and s.host_key is distinct from p_host_key then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if s.status = 'open' and s.ends_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'round_open', 'session', to_jsonb(s));
  end if;

  update public.auction_sessions
     set host_key = coalesce(s.host_key, case when p_uuid like 'mtg-%' then p_host_key end),
         round_no = s.round_no + 1,
         item_name = p_item,
         opening_bid = p_opening,
         current_bid = p_opening,
         last_bidder_id = null,
         last_bidder_name = null,
         reserve_price = p_reserve,
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

create or replace function public.stop_round(p_uuid text, p_host_key text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
begin
  if p_uuid like 'mtg-%' and p_host_key is null then
    return jsonb_build_object('ok', false, 'reason', 'unverified');
  end if;
  select * into s from public.auction_sessions where uuid = p_uuid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.host_key is not null and s.host_key is distinct from p_host_key then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if s.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'not_open', 'session', to_jsonb(s));
  end if;

  update public.auction_sessions
     set status = 'closed',
         closed_at = least(ends_at, now()),
         ends_at = least(ends_at, now()),
         updated_at = clock_timestamp()
   where uuid = p_uuid
   returning * into s;

  return jsonb_build_object('ok', true, 'session', to_jsonb(s));
end;
$$;

-- Atomic bid under the row lock, with reasons the API and tests can act on.
create or replace function public.place_bid(
  p_uuid text, p_amount integer, p_bidder_key text, p_bidder_name text, p_verified boolean
) returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_now timestamptz := now();
  v_min integer;
  v_ends timestamptz;
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

  -- First bid may equal the opening price; later bids must beat the leader.
  v_min := case when s.last_bidder_id is null then s.current_bid else s.current_bid + 1 end;
  if p_amount > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'over_max', 'session', to_jsonb(s));
  end if;
  if p_amount < v_min then
    return jsonb_build_object('ok', false, 'reason', 'too_low', 'min_amount', v_min, 'session', to_jsonb(s));
  end if;

  -- Anti-snipe: a bid inside the closing window pushes the clock out, and
  -- never backwards (colliding extensions keep the latest deadline).
  v_ends := s.ends_at;
  if s.ends_at - v_now < make_interval(secs => s.extend_window_seconds) then
    v_ends := greatest(s.ends_at, v_now + make_interval(secs => s.extend_by_seconds));
    v_extended := v_ends > s.ends_at;
  end if;

  update public.auction_sessions
     set current_bid = p_amount,
         last_bidder_id = p_bidder_key,
         last_bidder_name = p_bidder_name,
         ends_at = v_ends,
         updated_at = clock_timestamp()
   where uuid = p_uuid
   returning * into s;

  insert into public.auction_bids
    (session_uuid, round_no, amount, bidder_key, bidder_name, verified, created_at)
  values (p_uuid, s.round_no, p_amount, p_bidder_key, p_bidder_name, p_verified, clock_timestamp())
  returning id into v_bid_id;

  return jsonb_build_object('ok', true, 'extended', v_extended, 'bid_id', v_bid_id,
                            'session', to_jsonb(s));
end;
$$;

-- ------------------------------------------------------------------ grants
revoke execute on function public.ensure_session(text, text, integer) from public, anon, authenticated;
revoke execute on function public.session_state(text) from public, anon, authenticated;
revoke execute on function public.start_round(text, text, text, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.stop_round(text, text) from public, anon, authenticated;
revoke execute on function public.place_bid(text, integer, text, text, boolean) from public, anon, authenticated;

grant execute on function public.ensure_session(text, text, integer) to service_role;
grant execute on function public.session_state(text) to service_role;
grant execute on function public.start_round(text, text, text, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.stop_round(text, text) to service_role;
grant execute on function public.place_bid(text, integer, text, text, boolean) to service_role;
