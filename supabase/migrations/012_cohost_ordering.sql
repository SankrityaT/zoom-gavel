-- Zoom retries a notice that failed, so an older "became a co-host" can arrive
-- after a newer "stopped being one". Each (session, person) now keeps the
-- time of the newest notice applied, and an older one changes nothing.
-- Rows stay when the role ends (is_cohost = false) so the order is remembered.

alter table public.auction_cohosts
  add column if not exists is_cohost boolean not null default true,
  add column if not exists event_ts bigint not null default 0;

drop function if exists public.set_cohost(text, text, boolean);

create or replace function public.set_cohost(p_uuid text, p_key text, p_on boolean, p_ts bigint default 0)
returns jsonb
language plpgsql set search_path = public as $$
begin
  if p_uuid not like 'mtg-%' or p_key is null or p_key = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  insert into public.auction_sessions (uuid) values (p_uuid) on conflict (uuid) do nothing;
  if p_on and not exists (select 1 from public.auction_cohosts where session_uuid = p_uuid and bidder_key = p_key)
     and (select count(*) from public.auction_cohosts where session_uuid = p_uuid and is_cohost) >= 50 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  insert into public.auction_cohosts as c (session_uuid, bidder_key, is_cohost, event_ts)
  values (p_uuid, p_key, p_on, p_ts)
  on conflict (session_uuid, bidder_key) do update
    set is_cohost = excluded.is_cohost, event_ts = excluded.event_ts
    where excluded.event_ts >= c.event_ts;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_cohost(text, text, boolean, bigint) from public, anon, authenticated;
grant execute on function public.set_cohost(text, text, boolean, bigint) to service_role;

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
      select 1 from public.auction_cohosts
       where session_uuid = p_uuid and bidder_key = p_viewer_key and is_cohost);
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

notify pgrst, 'reload schema';
