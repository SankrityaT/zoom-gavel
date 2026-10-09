import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Viewer } from './auth'
import {
  toLeaderboard,
  toQueueItem,
  toSessionInfo,
  type BidReason,
  type LeaderRow,
  type QueueRow,
  type RoundReason,
  type RoundRow,
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

type RawState = {
  session: SessionRow
  leaderboard?: LeaderRow[]
  viewer_max?: number | null
  server_now: string
} | null

// viewerKey is passed only for a verified viewer: it is what lets the read
// return that viewer's own max bid and nobody else's.
export async function getRawState(uuid: string, viewerKey: string | null = null) {
  return rpc<RawState>('session_state', { p_uuid: uuid, p_viewer_key: viewerKey })
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
  | { ok: true; extended: boolean; bought?: boolean; amount?: number; bid_id: number; session: SessionRow }
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
  buyNowPrice: number | null
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
    p_buy_now: form.buyNowPrice,
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

// Assembles the client-facing state: camelCase session, leaderboard,
// server clock, and what this viewer may do. host_key is consumed here and
// never sent to the client. Bid amounts are private: a viewer gets their
// own (verified identity only) and the verified host gets all of them.
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
    leaderboard: toLeaderboard(
      raw.leaderboard ?? [],
      raw.session.current_bid,
      (key) => isHost || (viewer.verified && key === viewer.bidderKey),
    ),
    serverNow: raw.server_now,
    viewer: {
      verified: viewer.verified,
      bidderKey: viewer.bidderKey,
      isHost,
      canControl,
      inThisMeeting: viewer.inThisMeeting,
      maxBid: viewer.verified ? (raw.viewer_max ?? null) : null,
    },
  }
}

export async function getState(uuid: string, viewer: Viewer) {
  const raw = await getRawState(uuid, viewer.verified ? viewer.bidderKey : null)
  return raw ? buildState(raw, viewer) : null
}

// Finished rounds for a session, oldest first.
export async function getRounds(uuid: string) {
  const { data, error } = await getServiceClient()
    .from('auction_rounds')
    .select(
      'round_no, item_name, opening_bid, reserve_price, buy_now_price, final_bid, winner_key, winner_name, winner_verified, bid_count, outcome, bought_now, closed_at',
    )
    .eq('session_uuid', uuid)
    .order('round_no', { ascending: true })
    .limit(500)
  if (error) throw new Error(`rounds read failed: ${error.message}`)
  return (data ?? []) as RoundRow[]
}

export type MaxOutcome =
  | { ok: true; max: number | null; session: SessionRow }
  | { ok: false; reason: BidReason; min_amount?: number; max_allowed?: number; session?: SessionRow }

export async function setMaxBid(
  uuid: string,
  bidderKey: string,
  bidderName: string,
  verified: boolean,
  max: number | null,
) {
  return rpc<MaxOutcome>('set_max_bid', {
    p_uuid: uuid,
    p_bidder_key: bidderKey,
    p_bidder_name: bidderName,
    p_verified: verified,
    p_max: max,
  })
}

type QueueOutcome =
  | { ok: true; queue: QueueRow[]; session?: SessionRow }
  | { ok: false; reason: RoundReason; session?: SessionRow }

function withItems(outcome: QueueOutcome) {
  return outcome.ok ? { ok: true as const, queue: outcome.queue.map(toQueueItem) } : outcome
}

export async function getQueue(uuid: string) {
  return (await rpc<QueueRow[]>('queue_list', { p_uuid: uuid })).map(toQueueItem)
}

export async function queueAdd(
  uuid: string,
  hostKey: string | null,
  item: { itemName: string; openingBid: number; reservePrice: number | null; buyNowPrice: number | null; seconds: number },
) {
  return withItems(
    await rpc<QueueOutcome>('queue_add', {
      p_uuid: uuid,
      p_host_key: hostKey,
      p_item: item.itemName,
      p_opening: item.openingBid,
      p_reserve: item.reservePrice,
      p_buy_now: item.buyNowPrice,
      p_seconds: item.seconds,
    }),
  )
}

export async function queueRemove(uuid: string, hostKey: string | null, id: number) {
  return withItems(await rpc<QueueOutcome>('queue_remove', { p_uuid: uuid, p_host_key: hostKey, p_id: id }))
}

export async function queueStartNext(uuid: string, hostKey: string | null) {
  return withItems(
    await rpc<QueueOutcome>('queue_start_next', {
      p_uuid: uuid,
      p_host_key: hostKey,
      p_extend_window: 10,
      p_extend_by: 15,
    }),
  )
}
