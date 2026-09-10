-- Auction session state, keyed by the Zoom Collaborate UUID.
-- Writes happen only through our API (service role); clients read via
-- anon key and receive updates through Supabase Realtime.

create table public.auction_sessions (
  uuid text primary key,
  item_name text not null default 'Test lot',
  current_bid integer not null default 0,
  last_bidder_id text,
  status text not null default 'open' check (status in ('open', 'closed')),
  updated_at timestamptz not null default now()
);

alter table public.auction_sessions enable row level security;

-- Anyone (anon key) may read; there are intentionally no insert/update
-- policies, so all writes must come through the service role in our API.
create policy "sessions are publicly readable"
  on public.auction_sessions
  for select
  to anon, authenticated
  using (true);

-- Atomic bid placement: only strictly higher bids on open sessions win.
-- Concurrent lower/equal bids return zero rows instead of clobbering state.
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
  returning *;
$$;

revoke execute on function public.place_bid(text, integer, text)
  from public, anon, authenticated;

-- Stream row changes to subscribed clients.
alter publication supabase_realtime add table public.auction_sessions;

-- Explicit grants: objects created via the Management API do not receive
-- Supabase's default privileges, and the revoke above also strips
-- service_role's execute inherited from PUBLIC.
grant usage on schema public to anon, authenticated, service_role;
grant select on public.auction_sessions to anon, authenticated;
grant select, insert, update, delete on public.auction_sessions to service_role;
grant execute on function public.place_bid(text, integer, text) to service_role;
