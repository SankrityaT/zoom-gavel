import { boundedInt, boundedString } from './validate'

export type LotInput = {
  itemName: string
  openingBid: number
  reservePrice: number | null
  buyNowPrice: number | null
  seconds: number
}

// One lot as the host describes it. Buy Now must be reachable by bidding
// (above the opening bid) and can never sell below the reserve.
export function parseLot(payload: Record<string, unknown>): { lot: LotInput } | { error: string } {
  const itemName = boundedString(payload.itemName, 120)
  if (itemName === null) return { error: 'itemName is required' }
  const openingBid = boundedInt(payload.openingBid, 0)
  if (openingBid === null) return { error: 'openingBid must be an integer within bounds' }

  const optional = (value: unknown, min: number) =>
    value === undefined || value === null ? null : boundedInt(value, min)
  const reservePrice = optional(payload.reservePrice, 0)
  if (payload.reservePrice != null && reservePrice === null) {
    return { error: 'reservePrice must be an integer within bounds' }
  }
  const buyNowPrice = optional(payload.buyNowPrice, 1)
  if (payload.buyNowPrice != null && buyNowPrice === null) {
    return { error: 'buyNowPrice must be an integer within bounds' }
  }
  if (buyNowPrice !== null && (buyNowPrice <= openingBid || (reservePrice !== null && buyNowPrice < reservePrice))) {
    return { error: 'buyNowPrice must be above the opening bid and not below the reserve' }
  }
  const seconds = boundedInt(payload.seconds, 5, 3600)
  if (seconds === null) return { error: 'seconds must be between 5 and 3600' }
  return { lot: { itemName, openingBid, reservePrice, buyNowPrice, seconds } }
}
