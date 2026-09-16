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

// The identity cookie is SameSite=None (the Zoom web client embeds the app
// cross-site), so browser POSTs must prove same-origin: reject a foreign
// Origin header and any non-JSON body. Non-browser clients send no Origin.
export function rejectCrossSite(request: Request): string | null {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return 'content-type must be application/json'
  }
  const origin = request.headers.get('origin')
  if (origin) {
    const expected = new URL(request.url).origin
    if (origin !== expected) return 'cross-site request rejected'
  }
  return null
}
