'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BidResult, MaxResult } from '@/lib/gavel/client-api'
import { BID_STEP } from '@/lib/gavel/demo'
import type { LeaderEntry, SessionState } from '@/lib/gavel/types'
import type { AuctionSessionHook } from '@/panel/useAuctionSession'

// A pretend auction that runs in the browser, so the landing page can show
// the real panel components without a meeting or a server. It follows the
// server's rules: later bids must beat the leader, a late bid pushes the
// deadline out, and a bid at the Buy Now price ends the round.

export type SimPerson = { key: string; name: string }
export type SimEvent = { at: number; key: string; amount: number }

export type SimLot = {
  roundNo: number
  itemName: string
  openingBid: number
  reservePrice: number | null
  buyNowPrice: number | null
  seconds: number
  extendWindowSeconds: number
  extendBySeconds: number
  queuedCount: number
  upNext: string | null
}

export type SimRival = { key: string; ceiling: number }

type Standing = { amount: number; bids: number; lastAt: number }

type Resolved = {
  open: boolean
  price: number
  leaderKey: string | null
  endsAt: number
  extendedAt: number | null
  boughtNow: boolean
  lastBidAt: number | null
  /** How many bids have landed so far. */
  applied: number
  standings: Map<string, Standing>
}

export const SELF: SimPerson = { key: 'you-7c41', name: 'You' }

function resolve(lot: SimLot, events: SimEvent[], elapsed: number): Resolved {
  let price = lot.openingBid
  let leaderKey: string | null = null
  let endsAt = lot.seconds * 1000
  let extendedAt: number | null = null
  let boughtNow = false
  let lastBidAt: number | null = null
  let applied = 0
  const standings = new Map<string, Standing>()

  for (const event of events) {
    if (event.at > elapsed || event.at >= endsAt || boughtNow) break
    const bought = lot.buyNowPrice !== null && event.amount >= lot.buyNowPrice
    price = bought ? (lot.buyNowPrice as number) : event.amount
    leaderKey = event.key
    lastBidAt = event.at
    applied += 1
    const before = standings.get(event.key)
    standings.set(event.key, { amount: price, bids: (before?.bids ?? 0) + 1, lastAt: event.at })
    if (bought) {
      boughtNow = true
      endsAt = event.at
    } else if (endsAt - event.at <= lot.extendWindowSeconds * 1000) {
      const pushed = event.at + lot.extendBySeconds * 1000
      if (pushed > endsAt) {
        endsAt = pushed
        extendedAt = event.at
      }
    }
  }

  return { open: !boughtNow && elapsed < endsAt, price, leaderKey, endsAt, extendedAt, boughtNow, lastBidAt, applied, standings }
}

function toState(
  lot: SimLot,
  resolved: Resolved,
  people: SimPerson[],
  origin: number,
  elapsed: number,
  viewer: 'bidder' | 'host',
  maxBid: number | null,
): SessionState {
  const nameOf = (key: string) => people.find((person) => person.key === key)?.name ?? 'Bidder'
  const ranked = [...resolved.standings.entries()].sort(
    ([, a], [, b]) => b.amount - a.amount || a.lastAt - b.lastAt,
  )
  const leaderboard: LeaderEntry[] = ranked.map(([key, standing], index) => ({
    rank: index + 1,
    bidderKey: key,
    name: nameOf(key),
    verified: true,
    bids: standing.bids,
    lastBidAt: new Date(origin + standing.lastAt).toISOString(),
    amount: index === 0 || viewer === 'host' || key === SELF.key ? standing.amount : null,
  }))
  const leader = resolved.leaderKey ? { bidderKey: resolved.leaderKey, name: nameOf(resolved.leaderKey) } : null
  const iso = (ms: number) => new Date(origin + ms).toISOString()

  return {
    session: {
      uuid: 'landing-demo',
      itemName: lot.itemName,
      status: resolved.open ? 'open' : 'closed',
      roundNo: lot.roundNo,
      openingBid: lot.openingBid,
      currentBid: resolved.price,
      reservePrice: lot.reservePrice,
      reserveMet: lot.reservePrice === null || (leader !== null && resolved.price >= lot.reservePrice),
      buyNowPrice: lot.buyNowPrice,
      boughtNow: resolved.boughtNow,
      queuedCount: lot.queuedCount,
      upNext: lot.upNext,
      leader,
      endsAt: iso(resolved.endsAt),
      closedAt: resolved.open ? null : iso(resolved.endsAt),
      extendWindowSeconds: lot.extendWindowSeconds,
      extendBySeconds: lot.extendBySeconds,
      hostClaimed: true,
      hostVerified: true,
      sandbox: true,
      updatedAt: iso(resolved.lastBidAt ?? 0),
    },
    leaderboard,
    serverNow: iso(elapsed),
    viewer: {
      verified: true,
      bidderKey: SELF.key,
      isHost: viewer === 'host',
      canControl: viewer === 'host',
      inThisMeeting: true,
      maxBid,
    },
  }
}

type Options = {
  lot: SimLot
  people: SimPerson[]
  /** Bids that arrive on their own, in order, in ms from the start. */
  script?: SimEvent[]
  /** Pretend bidders who answer the price until it passes their ceiling. */
  rivals?: SimRival[]
  viewer?: 'bidder' | 'host'
  /** The visitor holds a paddle: their row reads "You". */
  asBidder?: boolean
  /** The visitor is bidding for real: the round is not reset off-screen. */
  persistent?: boolean
  /** Runs only while true: off-screen demos cost nothing. */
  active: boolean
  /** Start again this long after the hammer falls. */
  loopAfterMs?: number
  /** Or start again at this point, whether or not the round has closed. */
  loopAtMs?: number
  /** Where the round stands before it runs, and under reduced motion. */
  stillAt: number
  /** A max bid the visitor already holds when the picture is taken. */
  heldMax?: number
}

const TICK_MS = 200
const NOT_HOST = { ok: false as const, status: 403 }

export function useSimAuction({
  lot,
  people,
  script,
  rivals,
  viewer = 'bidder',
  asBidder = false,
  persistent = false,
  active,
  loopAfterMs,
  loopAtMs,
  stillAt,
  heldMax,
}: Options) {
  // `origin` is the wall-clock ms the round started at; null until it runs.
  const [origin, setOrigin] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(stillAt)
  const [extra, setExtra] = useState<SimEvent[]>([])
  const [maxBid, setMaxBidState] = useState<number | null>(heldMax ?? null)
  const extraRef = useRef<SimEvent[]>([])
  const maxRef = useRef<number | null>(null)
  const originRef = useRef<number | null>(null)
  // What the rendered state reflects, so the clock only re-renders the
  // panel when a bid lands or the round closes, as a real push would.
  const shown = useRef('')

  const events = useMemo(
    () => [...(script ?? []), ...extra].sort((a, b) => a.at - b.at),
    [script, extra],
  )

  const restart = useCallback(() => {
    extraRef.current = []
    maxRef.current = null
    setExtra([])
    setMaxBidState(null)
    const now = Date.now()
    originRef.current = now
    setOrigin(now)
    setElapsed(0)
  }, [])

  const push = useCallback((event: SimEvent) => {
    extraRef.current = [...extraRef.current, event]
    setExtra(extraRef.current)
  }, [])

  // Everything the pretend bidders (and the visitor's max bid) do next.
  const react = useCallback(
    (at: number) => {
      const all = () => [...(script ?? []), ...extraRef.current].sort((a, b) => a.at - b.at)
      let now = resolve(lot, all(), at)
      if (!now.open) return
      const next = () => (now.leaderKey === null ? lot.openingBid : now.price + BID_STEP)
      const underBuyNow = (amount: number) => lot.buyNowPrice === null || amount < lot.buyNowPrice

      if (rivals && rivals.length > 0) {
        const quiet = at - (now.lastBidAt ?? -1400)
        const count = all().length
        const gap = 2300 + ((count * 37) % 4) * 350
        if (quiet >= gap) {
          const amount = next()
          const able = rivals.filter((rival) => rival.key !== now.leaderKey && rival.ceiling >= amount)
          if (able.length > 0 && underBuyNow(amount)) {
            // Whoever has waited longest answers, so the board keeps moving.
            const rival = [...able].sort(
              (a, b) => (now.standings.get(a.key)?.lastAt ?? -1) - (now.standings.get(b.key)?.lastAt ?? -1),
            )[0]
            push({ at, key: rival.key, amount })
            now = resolve(lot, all(), at)
          }
        }
      }

      const max = maxRef.current
      if (max !== null && now.leaderKey !== SELF.key) {
        const amount = next()
        if (amount <= max && underBuyNow(amount)) push({ at: at + 1, key: SELF.key, amount })
      }
    },
    [lot, script, rivals, push],
  )

  useEffect(() => {
    if (!active) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still && !persistent) return
    if (originRef.current === null || !persistent) {
      // Scripted rounds start from the top each time they come into view.
      extraRef.current = []
      originRef.current = Date.now()
    }
    const id = setInterval(() => {
      const start = originRef.current
      if (start === null) return
      const at = Date.now() - start
      react(at)
      const state = resolve(lot, [...(script ?? []), ...extraRef.current].sort((a, b) => a.at - b.at), at)
      const over = !state.open && loopAfterMs !== undefined && at > state.endsAt + loopAfterMs
      if (over || (loopAtMs !== undefined && at > loopAtMs)) {
        restart()
        return
      }
      const signature = `${start}:${state.applied}:${state.open}`
      if (signature === shown.current) return
      shown.current = signature
      setOrigin(start)
      setExtra(extraRef.current)
      setElapsed(at)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [active, persistent, lot, script, loopAfterMs, loopAtMs, react, restart])

  const base = origin ?? 0
  const resolved = useMemo(() => resolve(lot, events, elapsed), [lot, events, elapsed])
  const state = useMemo(
    () => toState(lot, resolved, people, base, elapsed, viewer, maxBid),
    [lot, resolved, people, base, elapsed, viewer, maxBid],
  )

  const snapshot = useCallback(
    (at: number, nextMax: number | null) => {
      const all = [...(script ?? []), ...extraRef.current].sort((a, b) => a.at - b.at)
      return toState(lot, resolve(lot, all, at), people, originRef.current ?? 0, at, viewer, nextMax)
    },
    [lot, script, people, viewer],
  )

  const placeBid = useCallback(
    async (amount: number): Promise<BidResult> => {
      const start = originRef.current
      if (start === null) return { accepted: false, reason: 'not_open' }
      const at = Date.now() - start
      const all = [...(script ?? []), ...extraRef.current].sort((a, b) => a.at - b.at)
      const now = resolve(lot, all, at)
      if (!now.open) return { accepted: false, reason: 'expired', state: snapshot(at, maxRef.current) }
      const minAmount = now.leaderKey === null ? lot.openingBid : now.price + 1
      if (amount < minAmount) {
        return { accepted: false, reason: 'too_low', minAmount, state: snapshot(at, maxRef.current) }
      }
      push({ at, key: SELF.key, amount })
      const after = resolve(lot, [...all, { at, key: SELF.key, amount }], at)
      setElapsed(at)
      return {
        accepted: true,
        extended: after.extendedAt === at,
        bought: after.boughtNow,
        amount: after.price,
        state: snapshot(at, maxRef.current),
      }
    },
    [lot, script, push, snapshot],
  )

  const setMaxBid = useCallback(
    async (amount: number | null): Promise<MaxResult> => {
      const start = originRef.current
      if (start === null) return { ok: false, reason: 'not_open' }
      const at = Date.now() - start
      const all = [...(script ?? []), ...extraRef.current].sort((a, b) => a.at - b.at)
      const now = resolve(lot, all, at)
      if (!now.open) return { ok: false, reason: 'expired' }
      if (amount !== null) {
        const leading = now.leaderKey === SELF.key
        const floor = Math.max(1, leading ? now.price : now.leaderKey === null ? lot.openingBid : now.price + 1)
        if (amount < floor) return { ok: false, reason: 'too_low', minAmount: floor }
        if (lot.buyNowPrice !== null && amount >= lot.buyNowPrice) {
          return { ok: false, reason: 'over_buy_now', maxAllowed: lot.buyNowPrice - 1 }
        }
      }
      maxRef.current = amount
      setMaxBidState(amount)
      react(at)
      setElapsed(at)
      return { ok: true, max: amount, state: snapshot(at, amount) }
    },
    [lot, script, react, snapshot],
  )

  const frozenNow = base + elapsed
  const running = origin !== null
  const extendedAt = resolved.extendedAt === null || !running ? null : base + resolved.extendedAt

  const auction: AuctionSessionHook = useMemo(
    () => ({
      sync: { phase: 'live', state },
      transport: 'stream',
      selfKey: asBidder ? SELF.key : null,
      // A still demo holds its clock; a running one reads the real one.
      now: () => (running ? Date.now() : frozenNow),
      extendedAt,
      placeBid,
      maxBid,
      setMaxBid,
      absorb: () => undefined,
      startRound: async () => NOT_HOST,
      stopRound: async () => NOT_HOST,
      refresh: async () => undefined,
    }),
    [state, asBidder, running, frozenNow, extendedAt, placeBid, maxBid, setMaxBid],
  )

  return { state, auction, restart, running }
}
