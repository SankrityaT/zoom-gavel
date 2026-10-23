-- A winner's private page, and the host ticking off who has paid.
--
-- Gavel still never touches money. A winner gets an unguessable link to a
-- page that shows what they owe and where the host asked them to send it, so
-- they can pay after the meeting ends. The host marks lots as paid by hand.
--
-- The link is a random token held only by the winner (their panel asks for it
-- the same way it asks what they owe). It lives as long as the session does
-- and is deleted with it, and with the person if they remove the app.

alter table public.auction_rounds add column if not exists paid_at timestamptz;

create table if not exists public.auction_win_links (
  token text primary key check (char_length(token) between 24 and 64),
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  winner_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (session_uuid, winner_key)
);
alter table public.auction_win_links enable row level security;
revoke all on public.auction_win_links from anon, authenticated;
grant select, insert, update, delete on public.auction_win_links to service_role;

-- The winner's link: the one they already have, or p_token if this is the
-- first ask. Nothing for someone who has not won a lot here.
create or replace function public.win_link_for(p_uuid text, p_key text, p_token text)
returns text
language plpgsql set search_path = public as $$
declare
  v_token text;
begin
  if p_key is null or p_key = '' or p_key = 'removed' then
    return null;
  end if;
  if not exists (
    select 1 from public.auction_rounds
     where session_uuid = p_uuid and winner_key = p_key and outcome = 'sold'
  ) then
    return null;
  end if;
  insert into public.auction_win_links (token, session_uuid, winner_key)
  values (p_token, p_uuid, p_key)
  on conflict (session_uuid, winner_key) do nothing;
  select token into v_token
    from public.auction_win_links
   where session_uuid = p_uuid and winner_key = p_key;
  return v_token;
end;
$$;

-- What the page at a token shows: the winner's own lots, whether each is
-- marked paid, the host's payment line, and when the page goes away.
create or replace function public.winner_page(p_token text)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  l public.auction_win_links%rowtype;
  s public.auction_sessions%rowtype;
  v_wins jsonb;
  v_note text;
  v_ttl interval;
begin
  select * into l from public.auction_win_links where token = p_token;
  if not found then
    return null;
  end if;
  select * into s from public.auction_sessions where uuid = l.session_uuid;
  select coalesce(jsonb_agg(jsonb_build_object(
           'round_no', round_no, 'item_name', item_name, 'final_bid', final_bid,
           'bought_now', bought_now, 'paid', paid_at is not null, 'closed_at', closed_at)
           order by round_no), '[]'::jsonb)
    into v_wins
    from public.auction_rounds
   where session_uuid = l.session_uuid and winner_key = l.winner_key and outcome = 'sold';
  select note into v_note from public.auction_payment where session_uuid = l.session_uuid;
  v_ttl := case when l.session_uuid like 'mtg-%' then interval '30 days' else interval '24 hours' end;
  return jsonb_build_object('wins', v_wins, 'note', v_note, 'expires_at', s.updated_at + v_ttl);
end;
$$;

-- The host ticks a sold lot as paid, or takes the tick back.
create or replace function public.set_round_paid(p_uuid text, p_host_key text, p_round_no integer, p_paid boolean)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_refusal text;
  v_paid timestamptz;
begin
  v_refusal := public.host_gate(p_uuid, p_host_key);
  if v_refusal is not null then
    return jsonb_build_object('ok', false, 'reason', v_refusal);
  end if;
  update public.auction_rounds
     set paid_at = case when p_paid then coalesce(paid_at, clock_timestamp()) else null end
   where session_uuid = p_uuid and round_no = p_round_no and outcome = 'sold'
  returning paid_at into v_paid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'paid', v_paid is not null);
end;
$$;

-- As before, plus whether each lot is marked paid.
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
           'round_no', round_no, 'item_name', item_name, 'final_bid', final_bid,
           'bought_now', bought_now, 'paid', paid_at is not null)
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

-- Removing a person also removes the page links that name them.
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
  delete from public.auction_win_links where winner_key = p_bidder_key;
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

revoke execute on function public.win_link_for(text, text, text) from public, anon, authenticated;
revoke execute on function public.winner_page(text) from public, anon, authenticated;
revoke execute on function public.set_round_paid(text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.win_link_for(text, text, text) to service_role;
grant execute on function public.winner_page(text) to service_role;
grant execute on function public.set_round_paid(text, text, integer, boolean) to service_role;

notify pgrst, 'reload schema';
