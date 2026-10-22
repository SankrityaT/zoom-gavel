-- Host analytics: what the night raised, how many different people bid, and
-- where in a round bidders drop out. Everything is computed from the bids and
-- results already kept; the one new fact is when each lot started, which the
-- plan needs to place a bid "in the first fifth" or "in the last fifth".

create table if not exists public.auction_round_starts (
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  round_no integer not null,
  started_at timestamptz not null,
  planned_seconds integer not null,
  primary key (session_uuid, round_no)
);
alter table public.auction_round_starts enable row level security;
revoke all on public.auction_round_starts from anon, authenticated;
grant select, insert, update, delete on public.auction_round_starts to service_role;

-- A new round number on the session means a lot has just started, whichever
-- function started it (start_round, queue_start_next, a round replacing an
-- expired one). A trigger, so none of those functions had to change.
create or replace function public.log_round_start()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.round_no > 0 and new.status = 'open' then
    insert into public.auction_round_starts (session_uuid, round_no, started_at, planned_seconds)
    values (
      new.uuid, new.round_no, clock_timestamp(),
      greatest(0, round(extract(epoch from (coalesce(new.ends_at, clock_timestamp()) - clock_timestamp())))::integer))
    on conflict (session_uuid, round_no) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists auction_sessions_log_round_start on public.auction_sessions;
create trigger auction_sessions_log_round_start
  after update of round_no on public.auction_sessions
  for each row
  when (new.round_no is distinct from old.round_no)
  execute function public.log_round_start();

-- The numbers, for finished lots only. Counts only: no names, no amounts per
-- person, so nothing here identifies a bidder.
create or replace function public.session_analytics(p_uuid text)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_rounds integer;
  v_sold integer;
  v_raised bigint;
  v_opening bigint;
  v_bids integer;
  v_auto integer;
  v_unique integer;
  v_repeat integer;
  v_pairs integer;
  v_timed integer;
  v_acts integer[] := array[0, 0, 0, 0, 0];
  v_drop integer[] := array[0, 0, 0, 0, 0];
  rec record;
begin
  select count(*),
         count(*) filter (where outcome = 'sold'),
         coalesce(sum(final_bid) filter (where outcome = 'sold'), 0),
         coalesce(sum(opening_bid) filter (where outcome = 'sold'), 0)
    into v_rounds, v_sold, v_raised, v_opening
    from public.auction_rounds where session_uuid = p_uuid;

  select count(*),
         count(*) filter (where b.auto),
         count(distinct b.bidder_key) filter (where b.bidder_key <> 'removed')
    into v_bids, v_auto, v_unique
    from public.auction_bids b
    join public.auction_rounds r on r.session_uuid = b.session_uuid and r.round_no = b.round_no
   where b.session_uuid = p_uuid;

  select count(*) into v_repeat from (
    select b.bidder_key
      from public.auction_bids b
      join public.auction_rounds r on r.session_uuid = b.session_uuid and r.round_no = b.round_no
     where b.session_uuid = p_uuid and b.bidder_key <> 'removed'
     group by b.bidder_key
    having count(distinct b.round_no) > 1) x;

  select count(*) into v_pairs from (
    select b.round_no, b.bidder_key
      from public.auction_bids b
      join public.auction_rounds r on r.session_uuid = b.session_uuid and r.round_no = b.round_no
     where b.session_uuid = p_uuid
     group by b.round_no, b.bidder_key) x;

  select count(*) into v_timed
    from public.auction_rounds r
    join public.auction_round_starts s on s.session_uuid = r.session_uuid and s.round_no = r.round_no
   where r.session_uuid = p_uuid and r.closed_at > s.started_at;

  -- Where in the round each bid fell, in fifths of the time the lot ran.
  for rec in
    with timed as (
      -- Only a sale has a winner: a lot that missed its reserve still records its top bidder.
      select r.round_no, case when r.outcome = 'sold' then r.winner_key end as winner_key, s.started_at,
             greatest(extract(epoch from (r.closed_at - s.started_at)), 1) as dur
        from public.auction_rounds r
        join public.auction_round_starts s on s.session_uuid = r.session_uuid and s.round_no = r.round_no
       where r.session_uuid = p_uuid and r.closed_at > s.started_at)
    select least(4, greatest(0, floor(extract(epoch from (b.created_at - t.started_at)) / t.dur * 5)))::integer as bucket,
           count(*)::integer as n
      from public.auction_bids b join timed t on t.round_no = b.round_no
     where b.session_uuid = p_uuid
     group by 1
  loop
    v_acts[rec.bucket + 1] := rec.n;
  end loop;

  -- Where those who did not win made their last bid.
  for rec in
    with timed as (
      -- Only a sale has a winner: a lot that missed its reserve still records its top bidder.
      select r.round_no, case when r.outcome = 'sold' then r.winner_key end as winner_key, s.started_at,
             greatest(extract(epoch from (r.closed_at - s.started_at)), 1) as dur
        from public.auction_rounds r
        join public.auction_round_starts s on s.session_uuid = r.session_uuid and s.round_no = r.round_no
       where r.session_uuid = p_uuid and r.closed_at > s.started_at),
    lastbid as (
      select b.round_no, b.bidder_key,
             max(least(4, greatest(0, floor(extract(epoch from (b.created_at - t.started_at)) / t.dur * 5)))::integer) as bucket
        from public.auction_bids b join timed t on t.round_no = b.round_no
       where b.session_uuid = p_uuid and b.bidder_key <> 'removed'
         and b.bidder_key is distinct from t.winner_key
       group by b.round_no, b.bidder_key)
    select bucket, count(*)::integer as n from lastbid group by bucket
  loop
    v_drop[rec.bucket + 1] := rec.n;
  end loop;

  return jsonb_build_object(
    'rounds', v_rounds,
    'sold', v_sold,
    'raised', v_raised,
    'openingTotal', v_opening,
    'bids', v_bids,
    'autoBids', v_auto,
    'uniqueBidders', v_unique,
    'repeatBidders', v_repeat,
    'biddersPerRound', case when v_rounds > 0 then round(v_pairs::numeric / v_rounds, 1) else 0 end,
    'timedRounds', v_timed,
    'bidsByFifth', to_jsonb(v_acts),
    'dropOffByFifth', to_jsonb(v_drop));
end;
$$;

revoke execute on function public.log_round_start() from public, anon, authenticated;
revoke execute on function public.session_analytics(text) from public, anon, authenticated;
grant execute on function public.session_analytics(text) to service_role;

-- Removing a host's data keeps these counts; they hold nothing personal.
notify pgrst, 'reload schema';
