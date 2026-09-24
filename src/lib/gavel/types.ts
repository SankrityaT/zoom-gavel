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
}

export type BidRow = {
  id: number
  amount: number
  bidder_key: string
  bidder_name: string
  verified: boolean
  created_at: string
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

export type Bid = {
  id: number
  amount: number
  bidderKey: string
  bidderName: string
  verified: boolean
  createdAt: string
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
  bids: Bid[]
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

export function toBid(row: BidRow): Bid {
  return {
    id: row.id,
    amount: row.amount,
    bidderKey: row.bidder_key,
    bidderName: row.bidder_name,
    verified: row.verified,
    createdAt: row.created_at,
  }
}
