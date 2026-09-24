-- Backend hardening: rate limits, session expiry, and a Zoom-verified host.

-- ------------------------------------------------------------ rate limits
-- Fixed-window counters keyed by bucket (e.g. "bid:ip:1.2.3.4"). The API
-- checks several buckets in one call before any write.
create table if not exists public.rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

-- Counts one hit against every bucket; returns 0 when all are within
-- limits, otherwise the seconds until the tightest exceeded window resets.
-- Arrays are parallel: bucket i allows p_limits[i] hits per p_windows[i] s.
create or replace function public.rate_limit_hit(
  p_buckets text[], p_limits integer[], p_windows integer[]
) returns integer
language plpgsql set search_path = public as $$
declare
  i integer;
  r public.rate_limits%rowtype;
  v_window interval;
  v_retry integer := 0;
begin
  if array_length(p_buckets, 1) is distinct from array_length(p_limits, 1)
     or array_length(p_buckets, 1) is distinct from array_length(p_windows, 1) then
    raise exception 'rate_limit_hit: array lengths differ';
  end if;
  for i in 1 .. coalesce(array_length(p_buckets, 1), 0) loop
    v_window := make_interval(secs => p_windows[i]);
    insert into public.rate_limits as t (bucket, window_start, hits)
    values (p_buckets[i], now(), 1)
    on conflict (bucket) do update set
      window_start = case when t.window_start <= now() - v_window then now() else t.window_start end,
      hits = case when t.window_start <= now() - v_window then 1 else t.hits + 1 end
    returning * into r;
    if r.hits > p_limits[i] then
      v_retry := greatest(
        v_retry,
        greatest(1, ceil(extract(epoch from (r.window_start + v_window - now())))::integer)
      );
    end if;
  end loop;
  return v_retry;
end;
$$;

revoke execute on function public.rate_limit_hit(text[], integer[], integer[]) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text[], integer[], integer[]) to service_role;

-- ------------------------------------------------------- verified host
-- Set from Zoom's meeting.started webhook: host_key is then the HMAC of the
-- real meeting host's Zoom user id, and first-claim / stale reclaim no
-- longer apply to that session.
alter table public.auction_sessions
  add column if not exists host_verified boolean not null default false;

create or replace function public.set_meeting_host(p_uuid text, p_host_key text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
begin
  if p_uuid not like 'mtg-%' or p_host_key is null or p_host_key = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  insert into public.auction_sessions as t (uuid, host_key, host_verified)
  values (p_uuid, p_host_key, true)
  on conflict (uuid) do update set
    host_key = excluded.host_key,
    host_verified = true,
    updated_at = clock_timestamp()
  returning * into s;
  return jsonb_build_object('ok', true, 'session', to_jsonb(s));
end;
$$;

revoke execute on function public.set_meeting_host(text, text) from public, anon, authenticated;
grant execute on function public.set_meeting_host(text, text) to service_role;

-- start_round from 005, with the stale-claim takeover disabled once the
-- host is Zoom-verified.
create or replace function public.start_round(
  p_uuid text, p_host_key text, p_item text, p_opening integer,
  p_reserve integer, p_seconds integer, p_extend_window integer, p_extend_by integer
) returns jsonb
language plpgsql set search_path = public as $$
declare
  s public.auction_sessions%rowtype;
  v_stale boolean;
begin
  if p_seconds < 5 or p_seconds > 3600 then
    return jsonb_build_object('ok', false, 'reason', 'bad_seconds');
  end if;
  if p_uuid like 'mtg-%' and p_host_key is null then
    return jsonb_build_object('ok', false, 'reason', 'unverified');
  end if;

  insert into public.auction_sessions (uuid) values (p_uuid) on conflict (uuid) do nothing;
  select * into s from public.auction_sessions where uuid = p_uuid for update;

  v_stale := not s.host_verified
             and s.status <> 'open'
             and s.updated_at < now() - interval '2 hours';
  if s.host_key is not null and s.host_key is distinct from p_host_key and not v_stale then
    return jsonb_build_object('ok', false, 'reason', 'not_host');
  end if;
  if s.status = 'open' and s.ends_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'round_open', 'session', to_jsonb(s));
  end if;

  update public.auction_sessions
     set host_key = case
           when p_uuid like 'mtg-%' then coalesce(case when v_stale then p_host_key end, s.host_key, p_host_key)
           else null
         end,
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

-- -------------------------------------------------------------- expiry
-- Sandbox sessions (demo / join-link keys) live 24h after their last
-- activity, meeting sessions 30 days. A round left "open" a day past its
-- deadline counts as inactive. Bids cascade.
create or replace function public.expire_sessions()
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_sessions integer;
  v_buckets integer;
begin
  delete from public.auction_sessions
   where (status <> 'open' or ends_at < now() - interval '1 day')
     and (
       (uuid not like 'mtg-%' and updated_at < now() - interval '24 hours')
       or updated_at < now() - interval '30 days'
     );
  get diagnostics v_sessions = row_count;

  delete from public.rate_limits where window_start < now() - interval '1 hour';
  get diagnostics v_buckets = row_count;

  return jsonb_build_object('sessions', v_sessions, 'rate_buckets', v_buckets);
end;
$$;

revoke execute on function public.expire_sessions() from public, anon, authenticated;
grant execute on function public.expire_sessions() to service_role;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('gavel-expire-sessions', '17 * * * *', 'select public.expire_sessions()');
