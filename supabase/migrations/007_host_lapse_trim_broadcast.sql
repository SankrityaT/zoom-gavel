-- Review follow-ups to 006.
--
-- 1. A webhook-verified host no longer locks a session forever. Zoom's
--    meeting.started names the meeting owner, which is not always who runs
--    the meeting (alternative hosts, host transfer). Verified hosts keep
--    priority while active, but like first-claim hosts they lapse after
--    two idle hours, and a takeover clears host_verified.
-- 2. Session broadcasts stop carrying host_key. The value is the host's
--    public bidder key, so anyone holding a session key could tell which
--    bids were the host's. Clients only need to know whether a host exists.

create or replace function public.start_round(
  p_uuid text, p_host_key text, p_item text, p_opening integer,
  p_reserve integer, p_seconds integer, p_extend_window integer, p_extend_by integer
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

-- Same payload shape as realtime.broadcast_changes ({table, record, ...}),
-- with host_key replaced by a presence marker.
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
      'record', v_record
    ),
    TG_OP,
    'session:' || new.uuid,
    true
  );
  return null;
end;
$$;
