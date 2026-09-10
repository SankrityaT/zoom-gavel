export type AuctionSession = {
  uuid: string
  itemName: string
  currentBid: number
  lastBidderId: string | null
  status: 'open' | 'closed'
  updatedAt: string
}

export type AuctionSessionRow = {
  uuid: string
  item_name: string
  current_bid: number
  last_bidder_id: string | null
  status: 'open' | 'closed'
  updated_at: string
}

export function toSession(row: AuctionSessionRow): AuctionSession {
  return {
    uuid: row.uuid,
    itemName: row.item_name,
    currentBid: row.current_bid,
    lastBidderId: row.last_bidder_id,
    status: row.status,
    updatedAt: row.updated_at,
  }
}
