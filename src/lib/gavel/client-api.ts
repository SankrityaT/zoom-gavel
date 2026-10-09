import type { BidReason, QueueItem, RoundReason, RoundResult as RoundRecord, SessionState } from './types'

// The one place the browser talks to /api/session/[key]. Cookies ride along
// automatically on same-origin fetches, which is how verified identity
// reaches the server.
function sessionUrl(sessionKey: string, suffix = '') {
  return `/api/session/${encodeURIComponent(sessionKey)}${suffix}`
}

async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchState(sessionKey: string): Promise<SessionState | null> {
  const res = await fetch(sessionUrl(sessionKey), { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`session read failed (${res.status})`)
  return (await res.json()) as SessionState
}

export async function initSession(
  sessionKey: string,
  itemName: string,
  openingBid: number,
): Promise<SessionState> {
  const res = await postJson(sessionUrl(sessionKey), { init: true, itemName, openingBid })
  if (!res.ok) throw new Error(`session init failed (${res.status})`)
  return (await res.json()) as SessionState
}

export type BidResult =
  | { accepted: true; extended: boolean; bought: boolean; amount: number; state: SessionState }
  | { accepted: false; reason: BidReason; minAmount?: number; state?: SessionState }

export async function postBid(
  sessionKey: string,
  amount: number,
  bidderName: string,
): Promise<BidResult> {
  const res = await postJson(sessionUrl(sessionKey), { amount, bidderId: bidderName })
  if (res.status === 200 || res.status === 409) return (await res.json()) as BidResult
  if (res.status === 429) return { accepted: false, reason: 'rate_limited' }
  throw new Error(`bid failed (${res.status})`)
}

export type StartRoundInput = {
  itemName: string
  openingBid: number
  reservePrice: number | null
  buyNowPrice?: number | null
  seconds: number
  extendWindowSeconds?: number
  extendBySeconds?: number
}

export type RoundResult =
  | { ok: true; state: SessionState }
  | { ok: false; status: number; reason?: RoundReason; error?: string; state?: SessionState }

async function roundRequest(sessionKey: string, body: unknown): Promise<RoundResult> {
  const res = await postJson(sessionUrl(sessionKey, '/round'), body)
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return { ok: true, state: json.state as SessionState }
  if (res.status === 429) {
    return { ok: false, status: 429, reason: 'rate_limited', error: 'Too many requests. Try again in a moment.' }
  }
  return {
    ok: false,
    status: res.status,
    reason: json.reason as RoundReason | undefined,
    error: json.error as string | undefined,
    state: json.state as SessionState | undefined,
  }
}

export function startRound(sessionKey: string, input: StartRoundInput) {
  return roundRequest(sessionKey, { action: 'start', ...input })
}

export function stopRound(sessionKey: string) {
  return roundRequest(sessionKey, { action: 'stop' })
}

export function resultsUrl(sessionKey: string, format?: 'csv') {
  return sessionUrl(sessionKey, format ? '/results?format=csv' : '/results')
}

// Finished rounds; null when this viewer may not see them (not the host).
export async function fetchResults(sessionKey: string): Promise<RoundRecord[] | null> {
  const res = await fetch(resultsUrl(sessionKey), { cache: 'no-store' })
  if (res.status === 401 || res.status === 403 || res.status === 404) return null
  if (!res.ok) throw new Error(`results read failed (${res.status})`)
  return ((await res.json()) as { rounds: RoundRecord[] }).rounds
}

export type MaxResult =
  | { ok: true; max: number | null; state: SessionState }
  | { ok: false; reason: BidReason; minAmount?: number; maxAllowed?: number; state?: SessionState }

// Sets this bidder's max bid for the round; null removes it.
export async function postMaxBid(
  sessionKey: string,
  amount: number | null,
  bidderName: string,
): Promise<MaxResult> {
  const res = await postJson(sessionUrl(sessionKey, '/max'), { amount, bidderId: bidderName })
  if (res.status === 200 || res.status === 409) return (await res.json()) as MaxResult
  if (res.status === 429) return { ok: false, reason: 'rate_limited' }
  throw new Error(`max bid failed (${res.status})`)
}

// The host's lined-up lots; null when this viewer may not see them.
export async function fetchQueue(sessionKey: string): Promise<QueueItem[] | null> {
  const res = await fetch(sessionUrl(sessionKey, '/queue'), { cache: 'no-store' })
  if (res.status === 401 || res.status === 403 || res.status === 404) return null
  if (!res.ok) throw new Error(`queue read failed (${res.status})`)
  return ((await res.json()) as { queue: QueueItem[] }).queue
}

export type QueueResult =
  | { ok: true; queue: QueueItem[]; state: SessionState }
  | { ok: false; status: number; reason?: RoundReason; error?: string; state?: SessionState }

export type QueueLot = Omit<StartRoundInput, 'extendWindowSeconds' | 'extendBySeconds'>

async function queueRequest(sessionKey: string, body: unknown): Promise<QueueResult> {
  const res = await postJson(sessionUrl(sessionKey, '/queue'), body)
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return { ok: true, queue: json.queue as QueueItem[], state: json.state as SessionState }
  return {
    ok: false,
    status: res.status,
    reason: json.reason as RoundReason | undefined,
    error: json.error as string | undefined,
    state: json.state as SessionState | undefined,
  }
}

export const queueAdd = (sessionKey: string, lot: QueueLot) => queueRequest(sessionKey, { action: 'add', ...lot })
export const queueRemove = (sessionKey: string, id: number) => queueRequest(sessionKey, { action: 'remove', id })
export const queueStartNext = (sessionKey: string) => queueRequest(sessionKey, { action: 'start' })
