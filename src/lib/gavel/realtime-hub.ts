import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { toBid, toSessionInfo, type Bid, type BidRow, type SessionInfo, type SessionRow } from './types'

// Server-side fan-out for the SSE stream. One Supabase Realtime channel per
// session key per server instance, shared by every stream on that instance
// and torn down when the last one leaves. Events are sanitized here:
// SessionInfo never carries host_key, only hostClaimed / hostVerified.
//
// Uses the anon key: the private session:<key> topics are readable by
// anyone holding the key (migration 004), so no elevated role is needed on
// a long-lived socket.

export type HubEvent =
  | { type: 'session'; session: SessionInfo }
  | { type: 'bid'; bid: Bid; roundNo: number }
  | { type: 'down' }

type Listener = (event: HubEvent) => void

type Room = {
  channel: RealtimeChannel | null
  listeners: Set<Listener>
  ready: Promise<boolean>
  closed: boolean
}

let client: SupabaseClient | null = null
const rooms = new Map<string, Room>()
// Channels still leaving, by key. supabase-js hands back an existing
// same-topic channel until its leave completes, and subscribe() on a
// leaving channel never reports a status, so a new room waits these out.
const leaving = new Map<string, Promise<unknown>>()

function getClient() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('Supabase is not configured')
    client = createClient(url, anonKey, { auth: { persistSession: false } })
  }
  return client
}

function dropRoom(sessionKey: string, room: Room) {
  if (room.closed) return
  room.closed = true
  if (rooms.get(sessionKey) === room) rooms.delete(sessionKey)
  const channel = room.channel
  if (!channel) return
  const removal: Promise<unknown> = getClient()
    .removeChannel(channel)
    .catch(() => undefined)
    .finally(() => {
      if (leaving.get(sessionKey) === removal) leaving.delete(sessionKey)
    })
  leaving.set(sessionKey, removal)
}

function openRoom(sessionKey: string): Room {
  const listeners = new Set<Listener>()
  const emit = (event: HubEvent) => {
    for (const listener of listeners) listener(event)
  }
  const room: Room = { channel: null, listeners, ready: Promise.resolve(false), closed: false }

  room.ready = (async () => {
    const pending = leaving.get(sessionKey)
    if (pending) await pending
    if (room.closed) return false

    return new Promise<boolean>((resolve) => {
      const channel = getClient()
        .channel(`session:${sessionKey}`, { config: { private: true } })
        .on('broadcast', { event: 'UPDATE' }, (message) => {
          const payload = message.payload as { table?: string; record?: SessionRow }
          if (payload?.table === 'auction_sessions' && payload.record?.uuid === sessionKey) {
            emit({ type: 'session', session: toSessionInfo(payload.record) })
          }
        })
        .on('broadcast', { event: 'INSERT' }, (message) => {
          const payload = message.payload as {
            table?: string
            record?: BidRow & { round_no: number; session_uuid: string }
          }
          const record = payload?.record
          if (payload?.table === 'auction_bids' && record?.id && record.session_uuid === sessionKey) {
            emit({ type: 'bid', bid: toBid(record), roundNo: record.round_no })
          }
        })
      room.channel = channel

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          resolve(true)
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          resolve(false)
          // Drop the room so the next subscriber opens a fresh channel, and
          // close current streams: their clients reconnect and resnapshot.
          dropRoom(sessionKey, room)
          emit({ type: 'down' })
        }
      })
    })
  })()
  return room
}

export function subscribeSession(sessionKey: string, listener: Listener) {
  let room = rooms.get(sessionKey)
  if (!room) {
    room = openRoom(sessionKey)
    rooms.set(sessionKey, room)
  }
  const joined = room
  joined.listeners.add(listener)

  return {
    ready: joined.ready,
    unsubscribe() {
      joined.listeners.delete(listener)
      if (joined.listeners.size === 0) dropRoom(sessionKey, joined)
    },
  }
}
