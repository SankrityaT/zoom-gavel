-- Close public enumeration. With anon SELECT on the tables, anyone holding
-- the public anon key could list every session (including live meeting
-- keys) and every bid. Reads now go only through the API, which requires
-- knowing a session key, and realtime moves from table replication to
-- private per-session broadcast topics: you can receive a session's
-- updates only if you already know its key, and topics cannot be listed.

drop policy if exists "sessions are publicly readable" on public.auction_sessions;
drop policy if exists "bids are publicly readable" on public.auction_bids;
revoke select on public.auction_sessions from anon, authenticated;
revoke select on public.auction_bids from anon, authenticated;

alter publication supabase_realtime drop table public.auction_sessions;
alter publication supabase_realtime drop table public.auction_bids;

-- Broadcast row changes to topic session:<key>. security definer so the
-- trigger can write realtime.messages regardless of the calling role.
create or replace function public.broadcast_session_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.broadcast_changes(
    'session:' || new.uuid, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, new, old
  );
  return null;
end;
$$;

create or replace function public.broadcast_bid_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.broadcast_changes(
    'session:' || new.session_uuid, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, new, null
  );
  return null;
end;
$$;

drop trigger if exists auction_sessions_broadcast on public.auction_sessions;
create trigger auction_sessions_broadcast
  after update on public.auction_sessions
  for each row execute function public.broadcast_session_change();

drop trigger if exists auction_bids_broadcast on public.auction_bids;
create trigger auction_bids_broadcast
  after insert on public.auction_bids
  for each row execute function public.broadcast_bid_insert();

-- Anyone who knows a session key may receive that session's broadcasts.
drop policy if exists "session topics are readable by key" on realtime.messages;
create policy "session topics are readable by key"
  on realtime.messages
  for select
  to anon, authenticated
  using (realtime.topic() like 'session:%' and realtime.messages.extension = 'broadcast');
