import { MAX_BID } from './demo'
export { anonBidderKey } from './demo'

// Positive integer within the bid ceiling, or null.
export function boundedInt(value: unknown, min: number, max: number = MAX_BID): number | null {
  if (!Number.isInteger(value)) return null
  const n = value as number
  if (n < min || n > max) return null
  return n
}

export function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}
