import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Viewer } from './auth'
import {
  toBid,
  toSessionInfo,
  type BidReason,
  type BidRow,
  type RoundReason,
  type SessionRow,
  type SessionState,
} from './types'

// Service-role client, server only. Lazy so `next build` succeeds before
// env vars exist; never import this from client components.
let client: SupabaseClient | null = null

function getServiceClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      throw new Error(
        'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    client = createClient(url, serviceKey, { auth: { persistSession: false } })
  }
  return client
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getServiceClient().rpc(fn, args)
  if (error) throw new Error(`${fn} failed: ${error.message}`)
  return data as T
}

type RawState = { session: SessionRow; bids: BidRow[]; server_now: string } | null

export async function getRawState(uuid: string) {
  return rpc<RawState>('session_state', { p_uuid: uuid })
}

export async function ensureSession(uuid: string, itemName: string, openingBid: number) {
  const row = await rpc<SessionRow | null>('ensure_session', {
    p_uuid: uuid,
    p_item: itemName,
    p_opening: openingBid,
  })
  if (!row) throw new Error('ensureSession: no row returned')
  return row
}

export type BidOutcome =
  | { ok: true; extended: boolean; bid_id: number; session: SessionRow }
  | { ok: false; reason: BidReason; min_amount?: number; session?: SessionRow }

export async function placeBid(
  uuid: string,
  amount: number,
  bidderKey: string,
  bidderName: string,
  verified: boolean,
) {
  return rpc<BidOutcome>('place_bid', {
    p_uuid: uuid,
    p_amount: amount,
    p_bidder_key: bidderKey,
    p_bidder_name: bidderName,
    p_verified: verified,
  })
}

export type RoundOutcome =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: RoundReason; session?: SessionRow }

export type StartRoundForm = {
  itemName: string
  openingBid: number
  reservePrice: number | null
  seconds: number
  extendWindowSeconds: number
  extendBySeconds: number
}

export async function startRound(uuid: string, hostKey: string | null, form: StartRoundForm) {
  return rpc<RoundOutcome>('start_round', {
    p_uuid: uuid,
    p_host_key: hostKey,
    p_item: form.itemName,
    p_opening: form.openingBid,
    p_reserve: form.reservePrice,
    p_seconds: form.seconds,
    p_extend_window: form.extendWindowSeconds,
    p_extend_by: form.extendBySeconds,
  })
}

export async function stopRound(uuid: string, hostKey: string | null) {
  return rpc<RoundOutcome>('stop_round', { p_uuid: uuid, p_host_key: hostKey })
}

// Seconds until the tightest exhausted bucket resets, or 0 when allowed.
export async function rateLimitHit(
  rules: { bucket: string; limit: number; windowSeconds: number }[],
) {
  return rpc<number>('rate_limit_hit', {
    p_buckets: rules.map((r) => r.bucket),
    p_limits: rules.map((r) => r.limit),
    p_windows: rules.map((r) => r.windowSeconds),
  })
}

export async function setMeetingHost(uuid: string, hostKey: string) {
  return rpc<{ ok: boolean; reason?: string }>('set_meeting_host', {
    p_uuid: uuid,
    p_host_key: hostKey,
  })
}

// Assembles the client-facing state: camelCase session, ladder, server
// clock, and what this viewer may do. host_key is consumed here and never
// sent to the client.
export function buildState(raw: NonNullable<RawState>, viewer: Viewer): SessionState {
  const session = toSessionInfo(raw.session)
  const isHost =
    viewer.verified &&
    viewer.bidderKey !== null &&
    raw.session.host_key !== null &&
    viewer.bidderKey === raw.session.host_key
  const canControl =
    session.sandbox ||
    (viewer.verified && viewer.inThisMeeting && (!session.hostClaimed || isHost))
  return {
    session,
    bids: raw.bids.map(toBid),
    serverNow: raw.server_now,
    viewer: {
      verified: viewer.verified,
      bidderKey: viewer.bidderKey,
      isHost,
      canControl,
      inThisMeeting: viewer.inThisMeeting,
    },
  }
}

export async function getState(uuid: string, viewer: Viewer) {
  const raw = await getRawState(uuid)
  return raw ? buildState(raw, viewer) : null
}
