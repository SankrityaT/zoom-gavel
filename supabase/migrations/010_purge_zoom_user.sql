-- Removing what the app holds about one Zoom user, for Zoom's
-- app_deauthorized notice (the person removed the app, or asked Zoom to).
--
-- The tables hold no Zoom id, only a keyed hash of it (the bidder key), plus
-- the screen name the person chose. This takes that key and:
--   - deletes their max bids,
--   - renames their bids and any round they won to "Removed bidder" and
--     detaches the key, so the history of a sale stays whole but names nobody,
--   - drops the host claim on any meeting they hosted,
--   - clears them as the leader of any round still on the clock.
-- Pure function of the key; nothing else is touched.

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

revoke execute on function public.purge_zoom_user(text) from public, anon, authenticated;
grant execute on function public.purge_zoom_user(text) to service_role;

notify pgrst, 'reload schema';
