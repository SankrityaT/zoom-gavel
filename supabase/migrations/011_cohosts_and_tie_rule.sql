-- Two things.
--
-- 1. Co-hosts. Zoom's app context carries no role, so the server cannot learn
--    from the person's own session that they are a co-host. Zoom tells it, in
--    a signed meeting.participant_role_changed notice, and this keeps the
--    result: one row per (meeting session, bidder key) while the role holds.
--    A co-host runs rounds and sees what the host sees. The host's own claim
--    is never touched by a co-host (the API acts with the host's key).
--
-- 2. A tie between a plain hand bid and someone's hidden max bid. A hand bid
--    commits no ceiling, so when it lands exactly on another bidder's max,
--    that bidder, who committed first, takes the lead at the same price. (Max
--    against max keeps its rule: a tie stays with whoever leads.) Equal
--    amounts need a leaderboard tiebreak, or the wrong name could sit on top.

-- ================================================================ co-hosts
create table if not exists public.auction_cohosts (
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  bidder_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_uuid, bidder_key)
);
alter table public.auction_cohosts enable row level security;
revoke all on public.auction_cohosts from anon, authenticated;
grant select, insert, update, delete on public.auction_cohosts to service_role;

create or replace function public.set_cohost(p_uuid text, p_key text, p_on boolean)
returns jsonb
language plpgsql set search_path = public as $$
begin
  if p_uuid not like 'mtg-%' or p_key is null or p_key = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  -- A role can change before anyone opens the app, so make the session.
  insert into public.auction_sessions (uuid) values (p_uuid) on conflict (uuid) do nothing;
  if p_on then
    if (select count(*) from public.auction_cohosts where session_uuid = p_uuid) >= 50 then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    insert into public.auction_cohosts (session_uuid, bidder_key)
    values (p_uuid, p_key)
    on conflict do nothing;
  else
    delete from public.auction_cohosts where session_uuid = p_uuid and bidder_key = p_key;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_cohost(text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_cohost(text, text, boolean) to service_role;

-- session_state now also says whether this viewer is a co-host.
create or replace function public.session_state(p_uuid text, p_viewer_key text default null)
returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_max integer;
  v_cohost boolean := false;
begin
  update public.auction_sessions
     set status = 'closed', closed_at = ends_at, updated_at = clock_timestamp()
   where uuid = p_uuid and status = 'open' and ends_at <= now();

  select * into s from public.auction_sessions where uuid = p_uuid;
  if not found then return null; end if;

  if p_viewer_key is not null then
    select max_amount into v_max from public.auction_max_bids
     where session_uuid = p_uuid and round_no = s.round_no and bidder_key = p_viewer_key;
    v_cohost := exists (
      select 1 from public.auction_cohosts where session_uuid = p_uuid and bidder_key = p_viewer_key);
  end if;

  return jsonb_build_object(
    'session', to_jsonb(s),
    'leaderboard', public.round_leaderboard(p_uuid, s.round_no, true),
    'viewer_max', v_max,
    'viewer_cohost', v_cohost,
    'bids', '[]'::jsonb,
    'server_now', now());
end;
$$;

-- Removing someone (migration 010) now also removes their co-host rows.
create or replace function public.purge_zoom_user(p_bidder_key text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_max integer;
  v_bids integer;
  v_rounds integer;
  v_sessions integer;
begin
  if p_bidder_key is null or length(p_bidder_key) = 0 or p_bidder_key = 'removed' then
    return jsonb_build_object('ok', false, 'reason', 'bad_key');
  end if;

  delete from public.auction_cohosts where bidder_key = p_bidder_key;
  delete from public.auction_max_bids where bidder_key = p_bidder_key;
  get diagnostics v_max = row_count;

  update public.auction_bids
     set bidder_key = 'removed', bidder_name = 'Removed bidder', verified = false
   where bidder_key = p_bidder_key;
  get diagnostics v_bids = row_count;

  update public.auction_rounds
     set winner_key = 'removed', winner_name = 'Removed bidder', winner_verified = false
   where winner_key = p_bidder_key;
  get diagnostics v_rounds = row_count;

  update public.auction_sessions
     set host_key = case when host_key = p_bidder_key then null else host_key end,
         host_verified = case when host_key = p_bidder_key then false else host_verified end,
         last_bidder_id = case when last_bidder_id = p_bidder_key then 'removed' else last_bidder_id end,
         last_bidder_name = case when last_bidder_id = p_bidder_key then 'Removed bidder' else last_bidder_name end
   where host_key = p_bidder_key or last_bidder_id = p_bidder_key;
  get diagnostics v_sessions = row_count;

  return jsonb_build_object('ok', true, 'max_bids', v_max, 'bids', v_bids, 'rounds', v_rounds, 'sessions', v_sessions);
end;
$$;

-- ============================================================== tie rule
-- Equal best amounts: the one who bid last ranks first.
create or replace function public.round_leaderboard(p_uuid text, p_round integer, p_amounts boolean)
returns jsonb
language sql stable set search_path = public as $$
  select coalesce(
    jsonb_agg(case when p_amounts then x.e else x.e - 'amount' end order by x.best desc, x.last_id desc),
    '[]'::jsonb)
  from (
    select max(amount) as best,
           max(id) as last_id,
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
     order by max(amount) desc, max(id) desc
     limit 50
  ) x;
$$;

create or replace function public.resolve_max_bids(p_uuid text)
returns integer
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  c public.auction_max_bids%rowtype;
  v_lead_max integer;
  v_lead_verified boolean;
  v_lead_has_ceiling boolean;
  v_amount integer;
  v_step constant integer := 25;
  v_placed integer := 0;
begin
  for i in 1 .. 200 loop
    select * into s from public.auction_sessions where uuid = p_uuid;
    exit when s.status <> 'open';

    -- A challenger's ceiling must beat the price, except where the price was
    -- a plain hand bid (its owner set no ceiling): then a ceiling that sits
    -- exactly on it was committed first and wins the tie.
    select * into c
      from public.auction_max_bids
     where session_uuid = p_uuid and round_no = s.round_no
       and bidder_key is distinct from s.last_bidder_id
       and (max_amount > s.current_bid
            or (max_amount = s.current_bid
                and (s.last_bidder_id is null
                     or not exists (
                       select 1 from public.auction_max_bids l
                        where l.session_uuid = p_uuid and l.round_no = s.round_no
                          and l.bidder_key = s.last_bidder_id))))
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
      v_lead_has_ceiling := found;
      v_lead_max := greatest(coalesce(v_lead_max, s.current_bid), s.current_bid);

      if c.max_amount > v_lead_max then
        v_amount := least(c.max_amount, v_lead_max + v_step);
        perform public.apply_bid(p_uuid, v_amount, c.bidder_key, c.bidder_name, c.verified, true);
      elsif not v_lead_has_ceiling and c.max_amount = s.current_bid then
        -- The hand bid landed exactly on this ceiling: the ceiling takes the
        -- lead at the same price.
        perform public.apply_bid(p_uuid, s.current_bid, c.bidder_key, c.bidder_name, c.verified, true);
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

notify pgrst, 'reload schema';
