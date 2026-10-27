-- One optional photo per lot, added by the host or a co-host before the lot
-- starts. The picture is shrunk and stripped of location data in the host's
-- browser, stored here (small), and shown to bidders and to the winner.
--
-- The photo of a lot waiting to start never rides the session row, so it is
-- never broadcast: it sits in auction_next_photo until the round opens, and a
-- trigger then moves it onto the session as the live lot's photo.

create table if not exists public.auction_photos (
  id uuid primary key default gen_random_uuid(),
  session_uuid text not null references public.auction_sessions(uuid) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/webp')),
  data bytea not null check (octet_length(data) between 100 and 262144),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists auction_photos_session on public.auction_photos (session_uuid);
alter table public.auction_photos enable row level security;
revoke all on public.auction_photos from anon, authenticated;
grant select, insert, update, delete on public.auction_photos to service_role;

create table if not exists public.auction_next_photo (
  session_uuid text primary key references public.auction_sessions(uuid) on delete cascade,
  photo_id uuid not null
);
alter table public.auction_next_photo enable row level security;
revoke all on public.auction_next_photo from anon, authenticated;
grant select, insert, update, delete on public.auction_next_photo to service_role;

alter table public.auction_sessions add column if not exists photo_id uuid;
alter table public.auction_queue add column if not exists photo_id uuid;
alter table public.auction_rounds add column if not exists photo_id uuid;

-- When a new round opens, the waiting photo (if any) becomes its photo.
create or replace function public.take_next_photo()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.round_no is distinct from old.round_no then
    new.photo_id := (select photo_id from public.auction_next_photo where session_uuid = new.uuid);
    delete from public.auction_next_photo where session_uuid = new.uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists auction_sessions_take_photo on public.auction_sessions;
create trigger auction_sessions_take_photo
  before update on public.auction_sessions
  for each row execute function public.take_next_photo();

-- The record of a finished round keeps its photo (migration 008, plus photo_id).
create or replace function public.record_round()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.auction_sessions%rowtype;
  v_count integer;
  v_verified boolean;
begin
  if new.round_no = old.round_no then r := new; else r := old; end if;

  select count(*) into v_count
    from public.auction_bids where session_uuid = r.uuid and round_no = r.round_no;
  select verified into v_verified
    from public.auction_bids where session_uuid = r.uuid and round_no = r.round_no
   order by id desc limit 1;

  insert into public.auction_rounds
    (session_uuid, round_no, item_name, opening_bid, reserve_price, buy_now_price,
     final_bid, winner_key, winner_name, winner_verified, bid_count, outcome,
     bought_now, closed_at, photo_id)
  values
    (r.uuid, r.round_no, r.item_name, r.opening_bid, r.reserve_price, r.buy_now_price,
     r.current_bid, r.last_bidder_id, r.last_bidder_name, v_verified, v_count,
     case
       when r.last_bidder_id is null then 'no_bids'
       when r.reserve_price is not null and r.current_bid < r.reserve_price then 'reserve_not_met'
       else 'sold'
     end,
     r.bought_now, coalesce(r.closed_at, r.ends_at, now()), r.photo_id)
  on conflict (session_uuid, round_no) do nothing;
  return null;
end;
$$;

-- Stores a photo (base64 from the API) for this session, host only.
create or replace function public.add_photo(p_uuid text, p_host_key text, p_type text, p_b64 text)
returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  v_reason text;
  v_data bytea;
  v_id uuid;
begin
  v_reason := public.host_gate(p_uuid, p_host_key);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  if (select count(*) from public.auction_photos where session_uuid = p_uuid) >= 40 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  v_data := decode(p_b64, 'base64');
  if octet_length(v_data) < 100 or octet_length(v_data) > 262144 then
    return jsonb_build_object('ok', false, 'reason', 'bad_size');
  end if;
  insert into public.auction_photos (session_uuid, content_type, data)
  values (p_uuid, p_type, v_data)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- The bytes for one photo, by its unguessable id.
create or replace function public.get_photo(p_id uuid)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('type', content_type, 'b64', encode(data, 'base64'))
    from public.auction_photos where id = p_id;
$$;

-- The photo the next lot started directly will carry (null clears it).
create or replace function public.set_next_photo(p_uuid text, p_host_key text, p_photo_id uuid)
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_reason text;
begin
  v_reason := public.host_gate(p_uuid, p_host_key);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  if p_photo_id is null or not exists (
       select 1 from public.auction_photos where id = p_photo_id and session_uuid = p_uuid) then
    delete from public.auction_next_photo where session_uuid = p_uuid;
  else
    insert into public.auction_next_photo (session_uuid, photo_id) values (p_uuid, p_photo_id)
    on conflict (session_uuid) do update set photo_id = excluded.photo_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- The queue carries a photo per lot.
create or replace function public.queue_list(p_uuid text)
returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb)
    from (select id, item_name, opening_bid, reserve_price, buy_now_price, seconds, photo_id
            from public.auction_queue where session_uuid = p_uuid order by id) q;
$$;

drop function if exists public.queue_add(text, text, text, integer, integer, integer, integer);
create or replace function public.queue_add(
  p_uuid text, p_host_key text, p_item text, p_opening integer,
  p_reserve integer, p_buy_now integer, p_seconds integer, p_photo_id uuid default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_reason text;
  v_photo uuid;
begin
  if p_seconds < 5 or p_seconds > 3600 then
    return jsonb_build_object('ok', false, 'reason', 'bad_seconds');
  end if;
  if p_buy_now is not null and (
       p_buy_now <= p_opening or p_buy_now > 1000000
       or (p_reserve is not null and p_buy_now < p_reserve)) then
    return jsonb_build_object('ok', false, 'reason', 'bad_buy_now');
  end if;
  v_reason := public.host_gate(p_uuid, p_host_key);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  if (select count(*) from public.auction_queue where session_uuid = p_uuid) >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'queue_full');
  end if;
  select id into v_photo from public.auction_photos where id = p_photo_id and session_uuid = p_uuid;

  insert into public.auction_queue (session_uuid, item_name, opening_bid, reserve_price, buy_now_price, seconds, photo_id)
  values (p_uuid, p_item, p_opening, p_reserve, p_buy_now, p_seconds, v_photo);
  perform public.queue_refresh(p_uuid);
  return jsonb_build_object('ok', true, 'queue', public.queue_list(p_uuid));
end;
$$;

-- Starting the next queued lot hands its photo to the round it opens.
create or replace function public.queue_start_next(
  p_uuid text, p_host_key text, p_extend_window integer, p_extend_by integer
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_reason text;
  q public.auction_queue%rowtype;
  r jsonb;
  s public.auction_sessions%rowtype;
begin
  v_reason := public.host_gate(p_uuid, p_host_key);
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;
  select * into q from public.auction_queue where session_uuid = p_uuid order by id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'queue_empty');
  end if;

  if q.photo_id is null then
    delete from public.auction_next_photo where session_uuid = p_uuid;
  else
    insert into public.auction_next_photo (session_uuid, photo_id) values (p_uuid, q.photo_id)
    on conflict (session_uuid) do update set photo_id = excluded.photo_id;
  end if;

  r := public.start_round(p_uuid, p_host_key, q.item_name, q.opening_bid, q.reserve_price,
                          q.seconds, p_extend_window, p_extend_by, q.buy_now_price);
  if not (r->>'ok')::boolean then
    return r;
  end if;
  delete from public.auction_queue where id = q.id;
  perform public.queue_refresh(p_uuid);
  select * into s from public.auction_sessions where uuid = p_uuid;
  return jsonb_build_object('ok', true, 'session', to_jsonb(s), 'queue', public.queue_list(p_uuid));
end;
$$;

-- The winner's page shows each lot's photo too (migration 016, plus photo_id).
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
           'bought_now', bought_now, 'paid', paid_at is not null, 'closed_at', closed_at,
           'photo_id', photo_id)
           order by round_no), '[]'::jsonb)
    into v_wins
    from public.auction_rounds
   where session_uuid = l.session_uuid and winner_key = l.winner_key and outcome = 'sold';
  select note into v_note from public.auction_payment where session_uuid = l.session_uuid;
  v_ttl := case when l.session_uuid like 'mtg-%' then interval '30 days' else interval '24 hours' end;
  return jsonb_build_object('wins', v_wins, 'note', v_note, 'expires_at', s.updated_at + v_ttl);
end;
$$;

-- Removing a host also removes the photos they added to their auctions.
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
  delete from public.auction_photos
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

revoke execute on function public.add_photo(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.get_photo(uuid) from public, anon, authenticated;
revoke execute on function public.set_next_photo(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.queue_add(text, text, text, integer, integer, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.add_photo(text, text, text, text) to service_role;
grant execute on function public.get_photo(uuid) to service_role;
grant execute on function public.set_next_photo(text, text, uuid) to service_role;
grant execute on function public.queue_add(text, text, text, integer, integer, integer, integer, uuid) to service_role;

notify pgrst, 'reload schema';
