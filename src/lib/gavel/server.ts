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
  type Analytics,
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
  viewer_cohost?: boolean
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

// Forgets one Zoom user after they remove the app. The key is the keyed hash
// of their Zoom id, the only form in which the tables ever held it.
export async function purgeZoomUser(bidderKey: string) {
  return rpc<{ ok: boolean; reason?: string; max_bids?: number; bids?: number; rounds?: number; sessions?: number }>(
    'purge_zoom_user',
    { p_bidder_key: bidderKey },
  )
}

export type PaymentWin = { roundNo: number; itemName: string; finalBid: number; boughtNow: boolean }

// How winners pay. Set by the host; readable only by someone who has won.
export async function setPaymentNote(uuid: string, hostKey: string | null, note: string | null) {
  return rpc<{ ok: true; note: string | null } | { ok: false; reason: string }>('set_payment_note', {
    p_uuid: uuid,
    p_host_key: hostKey,
    p_note: note,
  })
}

export async function getPaymentNote(uuid: string) {
  return rpc<string | null>('get_payment_note', { p_uuid: uuid })
}

export async function paymentForWinner(uuid: string, bidderKey: string | null) {
  const raw = await rpc<{
    wins: { round_no: number; item_name: string; final_bid: number; bought_now: boolean; paid: boolean }[]
    note: string | null
  }>('payment_for_winner', { p_uuid: uuid, p_key: bidderKey })
  return {
    wins: raw.wins.map((w) => ({
      roundNo: w.round_no,
      itemName: w.item_name,
      finalBid: w.final_bid,
      boughtNow: w.bought_now,
      paid: w.paid === true,
    })) satisfies PaymentWin[],
    note: raw.note,
  }
}

// The winner's private page address, made on the first ask and the same after.
export async function winLinkFor(uuid: string, bidderKey: string | null, candidate: string) {
  return rpc<string | null>('win_link_for', { p_uuid: uuid, p_key: bidderKey, p_token: candidate })
}

export type WinnerPage = {
  wins: { round_no: number; item_name: string; final_bid: number; bought_now: boolean; paid: boolean; closed_at: string; photo_id: string | null }[]
  note: string | null
  expires_at: string
}

export async function winnerPage(token: string) {
  return rpc<WinnerPage | null>('winner_page', { p_token: token })
}

// The host ticks a sold lot as paid, or takes the tick back.
export async function setRoundPaid(uuid: string, hostKey: string | null, roundNo: number, paid: boolean) {
  return rpc<{ ok: true; paid: boolean } | { ok: false; reason: string }>('set_round_paid', {
    p_uuid: uuid,
    p_host_key: hostKey,
    p_round_no: roundNo,
    p_paid: paid,
  })
}

// Records a role change Zoom reported: on for a co-host (or a host who took
// over), off when they go back to attendee.
export async function setCohost(uuid: string, bidderKey: string, on: boolean, eventTs: number) {
  return rpc<{ ok: boolean; reason?: string }>('set_cohost', {
    p_uuid: uuid,
    p_key: bidderKey,
    p_on: on,
    p_ts: eventTs,
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
  // Zoom names co-hosts in a signed notice; the database holds that result.
  const isCohost =
    viewer.verified &&
    viewer.inThisMeeting &&
    raw.viewer_cohost === true &&
    !(viewer.bidderKey !== null && viewer.bidderKey === raw.session.host_key)
  const isHost =
    (raw.viewer_cohost === true && viewer.verified && viewer.inThisMeeting) ||
    (viewer.verified &&
      viewer.bidderKey !== null &&
      raw.session.host_key !== null &&
      viewer.bidderKey === raw.session.host_key)
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
      isCohost,
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

export async function getAnalytics(uuid: string) {
  return rpc<Analytics>('session_analytics', { p_uuid: uuid })
}

// Finished rounds for a session, oldest first.
export async function getRounds(uuid: string) {
  const { data, error } = await getServiceClient()
    .from('auction_rounds')
    .select(
      'round_no, item_name, opening_bid, reserve_price, buy_now_price, final_bid, winner_key, winner_name, winner_verified, bid_count, outcome, bought_now, closed_at, paid_at',
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
  item: { itemName: string; openingBid: number; reservePrice: number | null; buyNowPrice: number | null; seconds: number; photoId?: string | null },
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
      p_photo_id: item.photoId ?? null,
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

// Lot photos. The host's browser shrinks the picture; the bytes travel as base64.
export async function addPhoto(uuid: string, hostKey: string | null, type: string, bytes: Buffer) {
  return rpc<{ ok: true; id: string } | { ok: false; reason: string }>('add_photo', {
    p_uuid: uuid,
    p_host_key: hostKey,
    p_type: type,
    p_b64: bytes.toString('base64'),
  })
}

export async function getPhoto(id: string) {
  const row = await rpc<{ type: string; b64: string } | null>('get_photo', { p_id: id })
  return row ? { type: row.type, bytes: Buffer.from(row.b64, 'base64') } : null
}

// The photo the next lot started directly will carry; null clears it.
export async function setNextPhoto(uuid: string, hostKey: string | null, photoId: string | null) {
  return rpc<{ ok: boolean; reason?: string }>('set_next_photo', {
    p_uuid: uuid,
    p_host_key: hostKey,
    p_photo_id: photoId,
  })
}
