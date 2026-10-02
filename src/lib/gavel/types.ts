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
}

export type ViewerInfo = {
  verified: boolean
  bidderKey: string | null
  isHost: boolean
  canControl: boolean
  inThisMeeting: boolean
}

export type SessionState = {
  session: SessionInfo
  leaderboard: LeaderEntry[]
  serverNow: string
  viewer: ViewerInfo
}

export type BidReason =
  | 'not_found'
  | 'not_open'
  | 'expired'
  | 'too_low'
  | 'over_max'
  | 'rate_limited'
export type RoundReason =
  | 'bad_seconds'
  | 'bad_buy_now'
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
    leader,
    endsAt: row.ends_at,
    closedAt: row.closed_at,
    extendWindowSeconds: row.extend_window_seconds,
    extendBySeconds: row.extend_by_seconds,
    hostClaimed: row.host_key !== null,
    hostVerified: row.host_verified === true,
    sandbox: isSandboxKey(row.uuid),
    updatedAt: row.updated_at,
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
  }
}
