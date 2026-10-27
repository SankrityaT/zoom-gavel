export type SessionStatus = 'idle' | 'open' | 'closed'

// Row shapes as returned by the SQL functions (snake_case).
export type SessionRow = {
  uuid: string
  item_name: string
  current_bid: number
  last_bidder_id: string | null
  last_bidder_name: string | null
  status: SessionStatus
  updated_at: string
  host_key: string | null
  host_verified?: boolean
  round_no: number
  opening_bid: number
  reserve_price: number | null
  ends_at: string | null
  closed_at: string | null
  extend_window_seconds: number
  extend_by_seconds: number
  buy_now_price?: number | null
  bought_now?: boolean
  queue_count?: number
  queue_next?: string | null
  photo_id?: string | null
}

export type QueueRow = {
  id: number
  item_name: string
  opening_bid: number
  reserve_price: number | null
  buy_now_price: number | null
  seconds: number
  photo_id?: string | null
}

export type QueueItem = {
  id: number
  itemName: string
  openingBid: number
  reservePrice: number | null
  buyNowPrice: number | null
  seconds: number
  photoId: string | null
}

export function toQueueItem(row: QueueRow): QueueItem {
  return {
    id: row.id,
    itemName: row.item_name,
    openingBid: row.opening_bid,
    reservePrice: row.reserve_price,
    buyNowPrice: row.buy_now_price,
    seconds: row.seconds,
    photoId: row.photo_id ?? null,
  }
}

// One bidder's standing in a round. `amount` is present only in the copy
// the API server reads; the realtime broadcast omits it.
export type LeaderRow = {
  bidder_key: string
  bidder_name: string
  verified: boolean
  amount?: number
  bids: number
  last_bid_at: string
}

export type RoundRow = {
  round_no: number
  item_name: string
  opening_bid: number
  reserve_price: number | null
  buy_now_price: number | null
  final_bid: number
  winner_key: string | null
  winner_name: string | null
  winner_verified: boolean | null
  bid_count: number
  outcome: 'sold' | 'reserve_not_met' | 'no_bids'
  bought_now: boolean
  closed_at: string
  paid_at: string | null
}

// Client-facing shapes (camelCase). host_key never leaves the server raw;
// the viewer block carries the derived isHost instead.
export type SessionInfo = {
  uuid: string
  itemName: string
  status: SessionStatus
  roundNo: number
  openingBid: number
  currentBid: number
  reservePrice: number | null
  reserveMet: boolean
  buyNowPrice: number | null
  boughtNow: boolean
  /** Lots the host has lined up, and the name of the next one. Public. */
  queuedCount: number
  upNext: string | null
  leader: { bidderKey: string; name: string } | null
  endsAt: string | null
  closedAt: string | null
  extendWindowSeconds: number
  extendBySeconds: number
  hostClaimed: boolean
  /** Host set from Zoom's meeting.started webhook, not first claim. */
  hostVerified: boolean
  sandbox: boolean
  updatedAt: string
  /** The live lot's photo, if the host added one. */
  photoId: string | null
}

// Rank is public; `amount` is null unless this viewer may see it (their
// own entry, the leader's since that is the current price, or everything
// for the verified host).
export type LeaderEntry = {
  rank: number
  bidderKey: string
  name: string
  verified: boolean
  bids: number
  lastBidAt: string
  amount: number | null
}

export type RoundResult = {
  roundNo: number
  itemName: string
  openingBid: number
  reservePrice: number | null
  buyNowPrice: number | null
  finalBid: number
  winner: { bidderKey: string; name: string; verified: boolean } | null
  bidCount: number
  outcome: 'sold' | 'reserve_not_met' | 'no_bids'
  boughtNow: boolean
  closedAt: string
  /** The host has marked this sold lot as paid. */
  paid: boolean
}

export type ViewerInfo = {
  verified: boolean
  bidderKey: string | null
  /** The meeting's host, or a co-host Zoom has named: the same powers. */
  isHost: boolean
  /** True when the powers come from being a co-host. */
  isCohost: boolean
  canControl: boolean
  inThisMeeting: boolean
  /** This viewer's own max bid for the round. Verified viewers only; an
      unverified bidder's browser remembers its own. */
  maxBid: number | null
}

export type SessionState = {
  session: SessionInfo
  leaderboard: LeaderEntry[]
  serverNow: string
  viewer: ViewerInfo
}

// The host's numbers for the night, from finished lots only. Counts, never names.
export type Analytics = {
  rounds: number
  sold: number
  raised: number
  openingTotal: number
  bids: number
  autoBids: number
  uniqueBidders: number
  repeatBidders: number
  biddersPerRound: number
  /** Lots whose start time was recorded, so their bids can be placed in the round. */
  timedRounds: number
  /** Bids that fell in each fifth of a lot's running time, first to last. */
  bidsByFifth: number[]
  /** Bidders who did not win, by the fifth of the lot their last bid came in. */
  dropOffByFifth: number[]
}

export type BidReason =
  | 'not_found'
  | 'not_open'
  | 'expired'
  | 'too_low'
  | 'over_max'
  | 'over_buy_now'
  | 'host_cannot_bid'
  | 'rate_limited'
export type RoundReason =
  | 'bad_seconds'
  | 'bad_buy_now'
  | 'queue_full'
  | 'queue_empty'
  | 'unverified'
  | 'not_host'
  | 'round_open'
  | 'not_open'
  | 'not_found'
  | 'rate_limited'

export function isSandboxKey(sessionKey: string) {
  return !sessionKey.startsWith('mtg-')
}

export function toSessionInfo(row: SessionRow): SessionInfo {
  const leader =
    row.last_bidder_id !== null
      ? { bidderKey: row.last_bidder_id, name: row.last_bidder_name ?? 'Bidder' }
      : null
  return {
    uuid: row.uuid,
    itemName: row.item_name,
    status: row.status,
    roundNo: row.round_no,
    openingBid: row.opening_bid,
    currentBid: row.current_bid,
    reservePrice: row.reserve_price,
    reserveMet:
      row.reserve_price === null ||
      (leader !== null && row.current_bid >= row.reserve_price),
    buyNowPrice: row.buy_now_price ?? null,
    boughtNow: row.bought_now === true,
    queuedCount: row.queue_count ?? 0,
    upNext: row.queue_next ?? null,
    leader,
    endsAt: row.ends_at,
    closedAt: row.closed_at,
    extendWindowSeconds: row.extend_window_seconds,
    extendBySeconds: row.extend_by_seconds,
    hostClaimed: row.host_key !== null,
    hostVerified: row.host_verified === true,
    sandbox: isSandboxKey(row.uuid),
    updatedAt: row.updated_at,
    photoId: row.photo_id ?? null,
  }
}

// `mayReveal` decides per entry whether this viewer gets the amount. The
// leader's amount is always the public current price.
export function toLeaderboard(
  rows: LeaderRow[],
  currentBid: number,
  mayReveal: (bidderKey: string) => boolean = () => false,
): LeaderEntry[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    bidderKey: row.bidder_key,
    name: row.bidder_name,
    verified: row.verified,
    bids: row.bids,
    lastBidAt: row.last_bid_at,
    amount:
      index === 0
        ? currentBid
        : row.amount !== undefined && mayReveal(row.bidder_key)
          ? row.amount
          : null,
  }))
}

export function toRoundResult(row: RoundRow): RoundResult {
  return {
    roundNo: row.round_no,
    itemName: row.item_name,
    openingBid: row.opening_bid,
    reservePrice: row.reserve_price,
    buyNowPrice: row.buy_now_price,
    finalBid: row.final_bid,
    winner:
      row.winner_key !== null
        ? { bidderKey: row.winner_key, name: row.winner_name ?? 'Bidder', verified: row.winner_verified === true }
        : null,
    bidCount: row.bid_count,
    outcome: row.outcome,
    boughtNow: row.bought_now,
    closedAt: row.closed_at,
    paid: row.paid_at !== null,
  }
}
