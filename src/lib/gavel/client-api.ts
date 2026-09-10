import type { AuctionSession } from './types'

// The one place the browser talks to /api/session/[key]. Both the read
// and write paths share the URL construction and error handling so they
// cannot drift.
function sessionUrl(sessionKey: string) {
  return `/api/session/${encodeURIComponent(sessionKey)}`
}

export async function fetchSession(
  sessionKey: string,
): Promise<AuctionSession | null> {
  const res = await fetch(sessionUrl(sessionKey))
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`session read failed (${res.status})`)
  return (await res.json()) as AuctionSession
}

export async function initSession(
  sessionKey: string,
  itemName: string,
  openingBid: number,
): Promise<AuctionSession> {
  const res = await fetch(sessionUrl(sessionKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ init: true, itemName, openingBid }),
  })
  if (!res.ok) throw new Error(`session init failed (${res.status})`)
  return (await res.json()) as AuctionSession
}

export type BidResult =
  | { outcome: 'accepted'; session: AuctionSession }
  | { outcome: 'rejected' }

export async function postBid(
  sessionKey: string,
  amount: number,
  bidderId: string,
): Promise<BidResult> {
  const res = await fetch(sessionUrl(sessionKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount, bidderId }),
  })
  if (res.status === 409) return { outcome: 'rejected' }
  if (!res.ok) throw new Error(`bid failed (${res.status})`)
  return { outcome: 'accepted', session: (await res.json()) as AuctionSession }
}
