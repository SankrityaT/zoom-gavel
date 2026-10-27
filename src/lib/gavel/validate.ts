import { MAX_BID } from './demo'
export { anonBidderKey } from './demo'

// The browser's guest secret: absent, or 16 to 64 URL-safe characters.
export function guestSecretFrom(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : undefined
}

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
  // Postgres text cannot hold a NUL; refuse it here rather than fail later.
  if (!trimmed || trimmed.length > max || trimmed.includes('\u0000')) return null
  return trimmed
}

// The identity cookie is SameSite=None (the Zoom web client embeds the app
// cross-site), so browser POSTs must prove same-origin: reject a foreign
// Origin header and any non-JSON body. Non-browser clients send no Origin.
// A route that takes a file body names the types it accepts; the Origin check
// is the same.
export function rejectCrossSite(request: Request, accepts: string[] = ['application/json']): string | null {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!accepts.some((type) => contentType.startsWith(type))) {
    return `content-type must be ${accepts.join(' or ')}`
  }
  const origin = request.headers.get('origin')
  if (origin) {
    // Compare hosts from the headers the browser actually used. request.url
    // is rewritten to localhost by `next start` and behind the dev tunnel,
    // which would reject legitimate same-origin posts. A cross-site page
    // cannot set Host or X-Forwarded-Host, so this stays a CSRF guard.
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    let originHost: string | null = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (!host || originHost !== host) return 'cross-site request rejected'
  }
  return null
}

// Session keys are base64url meeting ids (mtg-...) or demo/join ids.
const SESSION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,200}$/

export function isSessionKey(value: string) {
  return SESSION_KEY_PATTERN.test(value)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

// A lot's photo id as the host sends it: absent means no photo.
export function photoIdFrom(value: unknown): { photoId: string | null } | { error: string } {
  if (value === undefined || value === null) return { photoId: null }
  if (!isUuid(value)) return { error: 'photoId is not valid' }
  return { photoId: value }
}
