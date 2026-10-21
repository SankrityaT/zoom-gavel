-- How winners pay. The app never takes money; the host says where to send it
-- ("Venmo @sam", a PayPal.Me link, a Zelle address) and only people who have
-- won something in this session can read it. One note per session, set by the
-- host (or a co-host acting with the host's key), under the same rule as the
-- queue. Never broadcast, never on the session row.

create table if not exists public.auction_payment (
  session_uuid text primary key references public.auction_sessions(uuid) on delete cascade,
  note text not null check (char_length(note) between 1 and 300),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.auction_payment enable row level security;
revoke all on public.auction_payment from anon, authenticated;
grant select, insert, update, delete on public.auction_payment to service_role;

-- Sets the note, or (p_note null) clears it.
create or replace function public.set_payment_note(p_uuid text, p_host_key text, p_note text)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_refusal text;
begin
  v_refusal := public.host_gate(p_uuid, p_host_key);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'reason', v_refusal);
  end if;
  if p_note is null then
    delete from public.auction_payment where session_uuid = p_uuid;
    return jsonb_build_object('ok', true, 'note', null);
  end if;
  if char_length(p_note) < 1 or char_length(p_note) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'bad_note');
  end if;
  insert into public.auction_payment (session_uuid, note)
  values (p_uuid, p_note)
  on conflict (session_uuid) do update set note = excluded.note, updated_at = clock_timestamp();
  return jsonb_build_object('ok', true, 'note', p_note);
end;
$$;

create or replace function public.get_payment_note(p_uuid text)
returns text
language sql stable set search_path = public as $$
  select note from public.auction_payment where session_uuid = p_uuid;
$$;

-- What this person owes, and where to send it: their sold lots in this
-- session, plus the note. Nothing at all for someone who has not won.
create or replace function public.payment_for_winner(p_uuid text, p_key text)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_wins jsonb;
  v_note text;
begin
  if p_key is null or p_key = '' then
    return jsonb_build_object('wins', '[]'::jsonb, 'note', null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'round_no', round_no, 'item_name', item_name, 'final_bid', final_bid, 'bought_now', bought_now)
           order by round_no), '[]'::jsonb)
    into v_wins
    from public.auction_rounds
   where session_uuid = p_uuid and winner_key = p_key and outcome = 'sold';
  if v_wins = '[]'::jsonb then
    return jsonb_build_object('wins', v_wins, 'note', null);
  end if;
  select note into v_note from public.auction_payment where session_uuid = p_uuid;
  return jsonb_build_object('wins', v_wins, 'note', v_note);
end;
$$;

-- Removing a person (migration 010 and 011) also removes a payment note they
-- set as host, since it can carry their own handle.
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

  delete from public.auction_payment
   where session_uuid in (select uuid from public.auction_sessions where host_key = p_bidder_key);
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

revoke execute on function public.set_payment_note(text, text, text) from public, anon, authenticated;
revoke execute on function public.get_payment_note(text) from public, anon, authenticated;
revoke execute on function public.payment_for_winner(text, text) from public, anon, authenticated;
grant execute on function public.set_payment_note(text, text, text) to service_role;
grant execute on function public.get_payment_note(text) to service_role;
grant execute on function public.payment_for_winner(text, text) to service_role;

notify pgrst, 'reload schema';
