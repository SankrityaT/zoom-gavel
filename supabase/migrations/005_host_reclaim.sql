-- Recovery path for the first-claim host model: a host claim can be taken
-- over once the session has sat idle or closed for two hours, so a stale
-- or abusive claim never bricks a meeting's session permanently. Live and
-- recently active sessions keep the existing owner.

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

  v_stale := s.status <> 'open' and s.updated_at < now() - interval '2 hours';
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
