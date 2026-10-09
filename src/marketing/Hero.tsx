'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import heroAtmosphere from './assets/hero-atmosphere.png'
import heroLot from './assets/hero-lot.png'
import {
  AppSidebar,
  DANA,
  GLASS_HORSE,
  HOST_NAME,
  MARCUS,
  PEOPLE,
  PRIYA,
  RoundPanel,
  useQuietCues,
  useTabVisible,
} from './demo'
import { publishLive } from './live'
import { type SimEvent, type SimLot, useSimAuction } from './sim'

// One round of the glass horse, told in 40 seconds: the price climbs past
// the reserve, a bid in the closing seconds pushes the clock out, and the
// hammer falls.
const HERO_LOT: SimLot = { ...GLASS_HORSE, seconds: 30 }

const HERO_SCRIPT: SimEvent[] = [
  { at: 2000, key: PRIYA.key, amount: 950 },
  { at: 4500, key: MARCUS.key, amount: 975 },
  { at: 7000, key: DANA.key, amount: 1025 },
  { at: 10000, key: PRIYA.key, amount: 1075 },
  { at: 13000, key: MARCUS.key, amount: 1100 },
  { at: 16000, key: DANA.key, amount: 1150 },
  { at: 19000, key: PRIYA.key, amount: 1175 },
  { at: 25000, key: MARCUS.key, amount: 1240 },
]

const GALLERY = [
  { name: 'Priya', tint: 'coral' },
  { name: 'Marcus', tint: 'sky' },
  { name: 'Dana', tint: 'sage' },
  { name: 'Theo', tint: 'sand' },
] as const

function MicOff() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="6" y="2" width="4" height="7" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2M2.5 2.5l11 11" />
    </svg>
  )
}

function Tool({ label, children, tone, count }: { label: string; children: React.ReactNode; tone?: 'on' | 'share'; count?: number }) {
  return (
    <span className={tone ? `zm-tool zm-tool--${tone}` : 'zm-tool'}>
      <span className="zm-tool-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
        {count !== undefined && <i>{count}</i>}
      </span>
      {label}
    </span>
  )
}

function ZoomMeeting() {
  // The round keeps running off-screen: the navigation carries it down the page.
  const visible = useTabVisible()
  const { state, auction, running } = useSimAuction({
    lot: HERO_LOT,
    people: PEOPLE,
    script: HERO_SCRIPT,
    active: visible,
    persistent: true,
    loopAfterMs: 6000,
    stillAt: 17000,
  })

  const { session } = state
  useEffect(() => {
    if (!running || session.endsAt === null) return
    publishLive({
      itemName: session.itemName,
      price: session.currentBid,
      endsAt: new Date(session.endsAt).getTime(),
      open: session.status === 'open',
      sold: session.status === 'closed' && session.leader !== null && session.reserveMet,
    })
  }, [running, session.itemName, session.currentBid, session.endsAt, session.status, session.leader, session.reserveMet])
  useEffect(() => () => publishLive(null), [])

  return (
    <div id="demo" className="zm">
      <p className="visually-hidden">
        A Zoom meeting with the Gavel app open in the side panel. The host, {HOST_NAME}, shows a cobalt glass horse on
        camera while three people bid on it. The round is simulated and repeats.
      </p>
      <div className="zm-titlebar" aria-hidden="true">
        <span className="zm-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="zm-title">Zoom Meeting</span>
        <span className="zm-view">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <rect x="1.5" y="2.5" width="5.5" height="4.5" rx="1" />
            <rect x="9" y="2.5" width="5.5" height="4.5" rx="1" />
            <rect x="1.5" y="9" width="5.5" height="4.5" rx="1" />
            <rect x="9" y="9" width="5.5" height="4.5" rx="1" />
          </svg>
          View
        </span>
      </div>

      <div className="zm-body">
        <div className="zm-stage" aria-hidden="true">
          <div className="zm-strip">
            {GALLERY.map((person) => (
              <figure key={person.name} className="zm-tile">
                <span className={`zm-face zm-face--${person.tint}`}>{person.name.charAt(0)}</span>
                <figcaption>
                  <MicOff />
                  {person.name}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="zm-speaker">
            <Image
              src={heroLot}
              alt=""
              fill
              priority
              sizes="(max-width: 900px) 100vw, 70vw"
              className="zm-speaker-image"
            />
            <span className="zm-speaker-name">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="6" y="2" width="4" height="7" rx="2" />
                <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" />
              </svg>
              {HOST_NAME} (Host)
            </span>
          </div>
        </div>

        <AppSidebar still className="zm-app--docked">
          <RoundPanel state={state} auction={auction} />
        </AppSidebar>
      </div>

      <div className="zm-toolbar" aria-hidden="true">
        <div className="zm-tools">
          <Tool label="Audio">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </Tool>
          <Tool label="Video">
            <rect x="3" y="6" width="13" height="12" rx="2.5" />
            <path d="M16 10.5 21 8v8l-5-2.5" />
          </Tool>
          <Tool label="Participants" count={GALLERY.length + 1}>
            <circle cx="9" cy="8" r="3.2" />
            <circle cx="16.5" cy="9.5" r="2.4" />
            <path d="M3.5 19a5.5 5.5 0 0 1 11 0M13.5 19a4.5 4.5 0 0 1 7-3.6" />
          </Tool>
          <Tool label="Chat">
            <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          </Tool>
          <Tool label="Share" tone="share">
            <rect x="3" y="4" width="18" height="14" rx="2.5" />
            <path d="M12 15V8M9 10.5 12 8l3 2.5" />
          </Tool>
          <Tool label="Apps" tone="on">
            <rect x="4" y="4" width="7" height="7" rx="1.8" />
            <rect x="13" y="4" width="7" height="7" rx="1.8" />
            <rect x="4" y="13" width="7" height="7" rx="1.8" />
            <rect x="13" y="13" width="7" height="7" rx="1.8" />
          </Tool>
        </div>
        <span className="zm-end">End</span>
      </div>
    </div>
  )
}

export default function Hero() {
  useQuietCues()

  return (
    <section className="hero" aria-label="Zoom Gavel, live bidding inside Zoom meetings">
      <div className="hero-atmosphere" aria-hidden="true">
        <Image src={heroAtmosphere} alt="" fill sizes="100vw" className="hero-atmosphere-image" />
      </div>

      <div className="hero-intro">
        <h1 className="hero-headline">
          The auction never
          <br />
          leaves the meeting.
        </h1>
        <p className="hero-sub">
          Live bidding inside the Zoom window itself. No second tab, no screen share pretending to be a sale.
        </p>
        <div className="hero-actions">
          <a className="button button--ink" href="/zoom-test">
            Open the panel
          </a>
          <a className="button button--quiet" href="#lot">
            See how a lot goes
          </a>
        </div>
      </div>

      <ZoomMeeting />
    </section>
  )
}
