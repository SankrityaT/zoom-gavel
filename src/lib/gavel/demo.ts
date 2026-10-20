// Single source of truth for the demo lot, shared by the marketing hero
// and the in-meeting panel so the two can never advertise different rules.
export const DEMO_LOT_NAME = 'Lot 001 · Glass horse'
export const DEMO_OPENING_BID = 950
export const BID_STEP = 25

// Hard ceiling well under Postgres int4 max: rejects griefing bids and
// makes integer overflow unreachable through the API.
export const MAX_BID = 1_000_000

export function formatUsd(amount: number) {
  return `$${amount.toLocaleString('en-US')}`
}

// Session keys travel in URL paths and Supabase Realtime filters, which
// choke on base64 characters Zoom uses in its UUIDs (+ / =). Base64url
// over the raw id gives a deterministic, filter-safe key.
export function toSessionKey(rawId: string) {
  const bytes = new TextEncoder().encode(rawId)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function describeError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

// Public identity for unverified bidders: a hash of the client-chosen name
// and, when the browser has one, its private guest secret. The secret never
// leaves the browser except to the server over HTTPS and is not in the hash's
// output, so nobody can bid, or change a max bid, as a guest they have only
// seen on the leaderboard. Without a secret (old clients, tools) it is the
// name alone, a separate set of identities that no secret-bearing guest shares.
// Isomorphic so the browser can recognise its own bids.
export async function anonBidderKey(bidderName: string, secret?: string | null) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(secret ? `anon:${bidderName}|${secret}` : `anon:${bidderName}`),
    ),
  )
  return 'a' + Array.from(digest.slice(0, 7), (b) => b.toString(16).padStart(2, '0')).join('')
}
