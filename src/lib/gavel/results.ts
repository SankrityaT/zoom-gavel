import type { RoundResult } from './types'

const OUTCOME_LABELS = {
  sold: 'Sold',
  reserve_not_met: 'Not sold (reserve not met)',
  no_bids: 'Not sold (no bids)',
} as const

export function outcomeLabel(round: RoundResult) {
  return round.outcome === 'sold' && round.boughtNow ? 'Sold (Buy Now)' : OUTCOME_LABELS[round.outcome]
}

// Names and item titles are user-typed and this file is opened in a
// spreadsheet: a cell starting with = + - @ (or a tab / carriage return)
// would run as a formula, so those get a leading apostrophe.
function cell(value: string | number | null) {
  if (value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function resultsCsv(rounds: RoundResult[]) {
  const header = [
    'Round',
    'Item',
    'Result',
    'Final price (USD)',
    'Winner',
    'Winner ID',
    'Winner verified by Zoom',
    'Bids',
    'Opening bid (USD)',
    'Reserve (USD)',
    'Buy Now (USD)',
    'Closed at (UTC)',
  ]
  const rows = rounds.map((round) => {
    const sold = round.outcome === 'sold'
    return [
      round.roundNo,
      round.itemName,
      outcomeLabel(round),
      sold ? round.finalBid : null,
      sold && round.winner ? round.winner.name : null,
      sold && round.winner ? `#${round.winner.bidderKey.slice(-4)}` : null,
      sold && round.winner ? (round.winner.verified ? 'yes' : 'no') : null,
      round.bidCount,
      round.openingBid,
      round.reservePrice,
      round.buyNowPrice,
      new Date(round.closedAt).toISOString(),
    ]
  })
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
