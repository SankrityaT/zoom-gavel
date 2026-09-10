-- One-round-trip session bootstrap: inserts if absent, otherwise returns
-- the existing row untouched (the no-op DO UPDATE makes RETURNING work
-- for both paths without ever clobbering a live bid).
create or replace function public.ensure_session(
  p_uuid text,
  p_item text,
  p_opening integer
)
returns setof public.auction_sessions
language sql
set search_path = public
as $$
  insert into public.auction_sessions (uuid, item_name, current_bid)
  values (p_uuid, p_item, p_opening)
  on conflict (uuid) do update set uuid = excluded.uuid
  returning *;
$$;

revoke execute on function public.ensure_session(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.ensure_session(text, text, integer)
  to service_role;

-- Defense in depth for the API-level bid ceiling: even a buggy or
-- bypassed server cannot push current_bid toward int4 overflow.
create or replace function public.place_bid(
  p_uuid text,
  p_amount integer,
  p_bidder text
)
returns setof public.auction_sessions
language sql
set search_path = public
as $$
  update public.auction_sessions
     set current_bid = p_amount,
         last_bidder_id = p_bidder,
         updated_at = now()
   where uuid = p_uuid
     and status = 'open'
     and p_amount > current_bid
     and p_amount <= 1000000
  returning *;
$$;
