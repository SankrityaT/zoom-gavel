'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { formatUsd } from '@/lib/gavel/demo'
import type { SessionState } from '@/lib/gavel/types'
import { BidDock, Bidders, LotTag, Toast } from '@/panel/AuctionPanel'
export { Toast }
import { setCuesSilenced, useCues } from '@/panel/cues'
import type { AuctionSessionHook } from '@/panel/useAuctionSession'
import logoMark from './assets/logo.png'
import type { SimLot, SimPerson } from './sim'
import { SELF } from './sim'

// The pretend meeting every demo on the page shares: one host, three
// bidders, one lot.
export const HOST_NAME = 'Maya'
export const PRIYA: SimPerson = { key: 'zm-priya-a3f1', name: 'Priya' }
export const MARCUS: SimPerson = { key: 'zm-marcus-9c2e', name: 'Marcus' }
export const DANA: SimPerson = { key: 'zm-dana-51b8', name: 'Dana' }
export const PEOPLE: SimPerson[] = [PRIYA, MARCUS, DANA, SELF]

export const GLASS_HORSE: SimLot = {
  roundNo: 1,
  itemName: 'Glass horse',
  openingBid: 950,
  reservePrice: 1100,
  buyNowPrice: 2000,
  seconds: 45,
  // The server's defaults.
  extendWindowSeconds: 10,
  extendBySeconds: 15,
  queuedCount: 2,
  upNext: 'Brass ship’s clock',
}

export const QUEUE = [
  { itemName: 'Brass ship’s clock', detail: 'Starts at $400 · Reserve $650 · 1 min' },
  { itemName: 'Hand-knotted wool rug', detail: 'Starts at $1,200 · Buy Now $3,000 · 2 min' },
]

// True while the element is on screen and the tab is visible.
export function useOnScreen(ref: RefObject<HTMLElement | null>, margin = '0px') {
  const [onScreen, setOnScreen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let inView = false
    const update = () => setOnScreen(inView && document.visibilityState === 'visible')
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting
        update()
      },
      { rootMargin: margin, threshold: 0.2 },
    )
    observer.observe(el)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [ref, margin])
  return onScreen
}

// True while the tab is the one being looked at.
export function useTabVisible() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

// The panel's sounds stay off on this page.
export function useQuietCues() {
  useEffect(() => {
    setCuesSilenced(true)
    return () => setCuesSilenced(false)
  }, [])
}

function headStatus(state: SessionState): { status: string; tone: string } {
  const { session, viewer, leaderboard } = state
  if (session.status === 'open') {
    return { status: leaderboard.length === 0 ? 'Bidding is open' : `${leaderboard.length} bidding`, tone: 'live' }
  }
  if (viewer.isHost) return HOSTING
  return { status: session.status === 'closed' ? 'Round over' : '', tone: '' }
}

const HOSTING = { status: "You're hosting", tone: 'host' }

/** The panel's own header, without the working mute switch. */
function PanelHead({ status, tone }: { status: string; tone: string }) {
  return (
    <header className="gv-head">
      <span className="gv-brand">
        <Image src={logoMark} alt="" width={28} height={28} />
        Gavel
      </span>
      <span className="gv-head-side">
        {status && (
          <span className={tone ? `gv-status gv-status--${tone}` : 'gv-status'}>
            {tone === 'live' && <i aria-hidden="true" />}
            {status}
          </span>
        )}
        <span className="gv-mute" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
            <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" />
            <path d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </span>
      </span>
    </header>
  )
}

export type PanelPart = 'head' | 'tag' | 'bidders' | 'dock' | 'after'
const EVERY_PART: PanelPart[] = ['head', 'tag', 'bidders', 'dock', 'after']

/** The live round, drawn by the panel's own components. `show` crops it to the parts a picture is about. */
export function RoundPanel({
  state,
  auction,
  alerts = false,
  show = EVERY_PART,
  children,
}: {
  state: SessionState
  auction: AuctionSessionHook
  /** Show the panel's outbid and sold banners. */
  alerts?: boolean
  show?: PanelPart[]
  children?: ReactNode
}) {
  const { session } = state
  const { alert, dismiss } = useCues(alerts ? state : null, auction.selfKey)
  const has = (part: PanelPart) => show.includes(part)
  return (
    <section className="gv" aria-label="Gavel panel">
      {has('head') && <PanelHead {...headStatus(state)} />}
      {alert && <Toast key={`alert-${alert.id}`} alert={alert} onDismiss={dismiss} />}
      {has('tag') && <LotTag state={state} auction={auction} />}
      {has('bidders') && <Bidders state={state} selfKey={auction.selfKey} />}
      {has('dock') && session.status === 'open' && (
        <BidDock key={`dock-${session.roundNo}`} state={state} auction={auction} />
      )}
      {has('after') && session.status === 'closed' && !state.viewer.isHost && (
        <p className="gv-after">
          {session.leader !== null && session.reserveMet ? 'The host will be in touch about payment. ' : ''}
          Up next: <b>{session.upNext}</b>
        </p>
      )}
      {children}
    </section>
  )
}

/** A piece of the panel on its own paper, for a picture: nothing in it can be pressed. */
export function Crop({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`crop ${className}`} inert>
      {children}
    </div>
  )
}

function StillSlot({ value, money, empty, caret }: { value: string; money?: boolean; empty?: boolean; caret?: boolean }) {
  const classes = ['gv-slot']
  if (money) classes.push('gv-slot--money')
  if (empty) classes.push('gv-slot--empty')
  if (caret) classes.push('gv-slot--typing')
  return (
    <span className={classes.join(' ')}>
      {money && !empty && <span aria-hidden="true">$</span>}
      <span className={empty ? 'gv-slot-text gv-slot-text--empty' : 'gv-slot-text'}>{value}</span>
      {caret && <i className="slot-caret" aria-hidden="true" />}
    </span>
  )
}

/** What the host has typed into the setup sentence so far; empty strings show the placeholders. */
export type LotDraft = { item: string; opening: string; reserve: string; buyNow: string }
const EMPTY_DRAFT: LotDraft = { item: '', opening: '', reserve: '', buyNow: '' }

/** The host's desk between rounds: the queue and the setup sentence. */
export function HostDeskPanel({
  blank = false,
  draft,
  typing,
}: {
  blank?: boolean
  /** A first lot being written; replaces the queue and the filled-in example. */
  draft?: LotDraft
  /** The field the caret is in. */
  typing?: keyof LotDraft | null
}) {
  const first = blank || draft !== undefined
  const lot = draft ?? (blank ? EMPTY_DRAFT : { item: 'Glass horse', opening: '950', reserve: '1,100', buyNow: '2,000' })
  const ready = lot.item !== '' && lot.opening !== '' && typing === null
  return (
    <section className="gv" aria-label="Gavel panel, host view">
      <PanelHead {...HOSTING} />
      {!first && (
        <div className="gv-queue">
          <div className="gv-sect">
            <h3>Up next</h3>
            <span>{QUEUE.length} lots lined up</span>
          </div>
          <ol className="gv-queue-list">
            {QUEUE.map((queued, index) => (
              <li key={queued.itemName}>
                <span className="gv-queue-no" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="gv-name">
                  <strong>{queued.itemName}</strong>
                  <span>{queued.detail}</span>
                </span>
                <span className="gv-queue-remove">Remove</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="gv-setup">
        <p className="gv-setup-kicker">{first ? 'Your first lot' : 'Add another lot'}</p>
        <p className="gv-sentence">
          Sell <StillSlot value={lot.item || 'an item'} empty={!lot.item} caret={typing === 'item'} /> starting at{' '}
          <span className="gv-keep">
            <StillSlot value={lot.opening || '$0'} money empty={!lot.opening} caret={typing === 'opening'} />,
          </span>{' '}
          reserve{' '}
          <span className="gv-keep">
            <StillSlot value={lot.reserve || 'None'} money empty={!lot.reserve} caret={typing === 'reserve'} />,
          </span>{' '}
          Buy Now{' '}
          <span className="gv-keep">
            <StillSlot value={lot.buyNow || 'None'} money empty={!lot.buyNow} caret={typing === 'buyNow'} />.
          </span>
        </p>
        <div className="gv-lengths">
          {['30 sec', '1 min', '2 min', '5 min'].map((label) => (
            <span key={label} className={label === '1 min' ? 'gv-length gv-length--on' : 'gv-length'}>
              {label}
            </span>
          ))}
        </div>
        <div className="gv-setup-actions">
          <span className={first && !ready ? 'gv-start gv-start--quiet gv-start--waiting' : 'gv-start gv-start--quiet'}>
            Add to queue
          </span>
          <span className={first && !ready ? 'gv-start gv-start--waiting' : 'gv-start'}>
            {first ? 'Start bidding' : 'Start this now'}
          </span>
        </div>
      </div>
    </section>
  )
}

// Lots a host might put up first, typed into the sentence one after another.
const FIRST_LOTS: LotDraft[] = [
  { item: 'Signed team jersey', opening: '40', reserve: '', buyNow: '120' },
  { item: 'A week at the lake cabin', opening: '300', reserve: '500', buyNow: '' },
  { item: 'Grandfather clock', opening: '650', reserve: '', buyNow: '1,200' },
]
const FIELDS: (keyof LotDraft)[] = ['item', 'opening', 'reserve', 'buyNow']
const KEY_MS = 55
const FIELD_PAUSE_MS = 320
const HOLD_MS = 2600

/** The host's first lot, being typed into the sentence. Under reduced motion it stands written. */
export function TypedFirstLot() {
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(ref)
  const [lotIndex, setLotIndex] = useState(0)
  const [draft, setDraft] = useState<LotDraft>(FIRST_LOTS[0])
  const [typing, setTyping] = useState<keyof LotDraft | null>(null)

  useEffect(() => {
    if (!onScreen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const target = FIRST_LOTS[lotIndex]
    const timers: ReturnType<typeof setTimeout>[] = []
    let at = 400
    const later = (fn: () => void) => timers.push(setTimeout(fn, at))
    later(() => {
      setDraft(EMPTY_DRAFT)
      setTyping('item')
    })
    for (const field of FIELDS) {
      const text = target[field]
      later(() => setTyping(field))
      for (let length = 1; length <= text.length; length += 1) {
        at += KEY_MS
        later(() => setDraft((current) => ({ ...current, [field]: text.slice(0, length) })))
      }
      at += FIELD_PAUSE_MS
    }
    later(() => setTyping(null))
    at += HOLD_MS
    later(() => setLotIndex((index) => (index + 1) % FIRST_LOTS.length))
    return () => timers.forEach(clearTimeout)
  }, [onScreen, lotIndex])

  return (
    <div ref={ref}>
      <HostDeskPanel draft={draft} typing={typing} />
    </div>
  )
}

const RESULTS = [
  { itemName: 'Glass horse', winner: 'Marcus', price: 1240 },
  { itemName: 'Brass ship’s clock', winner: 'Dana', price: 700 },
  { itemName: 'Hand-knotted wool rug', winner: 'Priya, Buy Now', price: 3000 },
]

/** The host's running receipt, as the panel prints it. */
export function ReceiptSlip({ lots = RESULTS.length }: { lots?: number }) {
  const rounds = RESULTS.slice(0, lots)
  const total = rounds.reduce((sum, round) => sum + round.price, 0)
  return (
    <div className="gv-receipt-wrap">
      <div className="gv-receipt">
        <h3>So far</h3>
        <ol>
          {rounds.map((round) => (
            <li key={round.itemName}>
              <span>
                {round.itemName}
                <em>{round.winner}</em>
              </span>
              <span>{formatUsd(round.price)}</span>
            </li>
          ))}
        </ol>
        <p className="gv-receipt-total">
          <span>Raised</span>
          <span>{formatUsd(total)}</span>
        </p>
      </div>
      <div className="gv-receipt-foot">
        <span className="gv-receipt-link">Download CSV</span>
        <span>
          {rounds.length} of {rounds.length} sold
        </span>
      </div>
    </div>
  )
}

/** Zoom's app sidebar, with the panel inside it. */
export function AppSidebar({
  children,
  still = false,
  className = '',
  panelRef,
}: {
  children: ReactNode
  /** A picture of the panel: nothing in it can be focused or pressed. */
  still?: boolean
  className?: string
  panelRef?: RefObject<HTMLDivElement | null>
}) {
  const fallback = useRef<HTMLDivElement>(null)
  return (
    <div className={`zm-app ${className}`} ref={panelRef ?? fallback}>
      <div className="zm-app-bar" aria-hidden="true">
        <span className="zm-app-name">
          <Image src={logoMark} alt="" width={18} height={18} />
          Gavel
        </span>
        <span className="zm-app-tools">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M9.5 3H13v3.5M13 3 8.5 7.5M6.5 3H3v10h10V9.5" />
          </svg>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </span>
      </div>
      <div className="zm-app-body" inert={still}>
        {children}
      </div>
    </div>
  )
}
