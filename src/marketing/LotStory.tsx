'use client'

import { useCallback, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  AppSidebar,
  DANA,
  GLASS_HORSE,
  HostDeskPanel,
  MARCUS,
  PEOPLE,
  PRIYA,
  ReceiptSlip,
  RoundPanel,
  useOnScreen,
} from './demo'
import { DESKTOP, ScrollTrigger, gsap, useGSAP } from './motion'
import { PaperTag } from './paper'
import { SELF, type SimEvent, type SimLot, useSimAuction } from './sim'

// Bidding as it opens: the price climbs and the board reorders.
const OPEN_SCRIPT: SimEvent[] = [
  { at: 1200, key: PRIYA.key, amount: 950 },
  { at: 3400, key: MARCUS.key, amount: 975 },
  { at: 5600, key: SELF.key, amount: 1000 },
  { at: 7800, key: DANA.key, amount: 1025 },
  { at: 10000, key: PRIYA.key, amount: 1050 },
  { at: 12200, key: SELF.key, amount: 1075 },
]

// The closing seconds: the visitor leads, is outbid with five seconds
// left, and the deadline moves.
const LATE_LOT: SimLot = { ...GLASS_HORSE, seconds: 14 }
const LATE_SCRIPT: SimEvent[] = [
  { at: 0, key: PRIYA.key, amount: 1100 },
  { at: 0, key: MARCUS.key, amount: 1125 },
  { at: 0, key: SELF.key, amount: 1150 },
  { at: 9000, key: MARCUS.key, amount: 1175 },
  { at: 13500, key: SELF.key, amount: 1200 },
]

// The hammer falls: the host's view, every amount showing. The clock runs
// out its last seconds with no late bid, so nothing moves the deadline.
const SOLD_LOT: SimLot = { ...GLASS_HORSE, seconds: 5, extendWindowSeconds: 0 }
const SOLD_SCRIPT: SimEvent[] = [
  { at: 0, key: DANA.key, amount: 1150 },
  { at: 0, key: PRIYA.key, amount: 1175 },
  { at: 0, key: MARCUS.key, amount: 1240 },
]

function subscribeDesktop(callback: () => void) {
  const query = window.matchMedia(DESKTOP)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function OpenRound({ active }: { active: boolean }) {
  const { state, auction } = useSimAuction({
    lot: GLASS_HORSE,
    people: PEOPLE,
    script: OPEN_SCRIPT,
    asBidder: true,
    active,
    loopAtMs: 16000,
    stillAt: 8000,
  })
  return <RoundPanel state={state} auction={auction} />
}

function LateRound({ active }: { active: boolean }) {
  const { state, auction } = useSimAuction({
    lot: LATE_LOT,
    people: PEOPLE,
    script: LATE_SCRIPT,
    asBidder: true,
    active,
    loopAtMs: 19000,
    stillAt: 9500,
  })
  return <RoundPanel state={state} auction={auction} alerts />
}

function SoldRound({ active }: { active: boolean }) {
  const { state, auction } = useSimAuction({
    lot: SOLD_LOT,
    people: PEOPLE,
    script: SOLD_SCRIPT,
    viewer: 'host',
    active,
    loopAfterMs: 8000,
    // Standing still, it shows the lot after the clock has stopped.
    stillAt: 60_000,
  })
  return (
    <RoundPanel state={state} auction={auction}>
      {state.session.status === 'closed' && <ReceiptSlip lots={1} />}
    </RoundPanel>
  )
}

const CHAPTERS: { title: string; tone: string; body: ReactNode }[] = [
  {
    title: 'The host says what is for sale',
    tone: 'sand',
    body: (
      <>
        A lot is set up as a sentence: the item, where bidding starts, a reserve if there is one, and a Buy Now price
        if the host wants one. Start it now, or line the night up in the queue.
      </>
    ),
  },
  {
    title: 'Everyone bids from the side panel',
    tone: 'blue',
    body: (
      <>
        One tap bids the next $25. Measured on the production deployment, a bid reached the other screens in 160 to
        370 milliseconds.
      </>
    ),
  },
  {
    title: 'A late bid adds time',
    tone: 'coral',
    body: (
      <>
        A bid in the last 10 seconds moves the deadline to 15 seconds after it, so nobody wins by waiting for the
        final second. If someone passes you, the panel says so at once.
      </>
    ),
  },
  {
    title: 'The hammer falls',
    tone: 'mint',
    body: (
      <>
        The clock stops and the lot is stamped Sold. The host sees every amount and keeps a receipt of the night, with
        a CSV for collecting payment afterward.
      </>
    ),
  },
]

export default function LotStory() {
  const root = useRef<HTMLElement>(null)
  const [current, setCurrent] = useState(0)
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  )
  const onScreen = useOnScreen(root)

  // On a wide screen the section pins and the scroll position picks the
  // chapter. On a phone every chapter is laid out in full.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(DESKTOP, () => {
        ScrollTrigger.create({
          trigger: root.current,
          start: 'top top',
          end: 'bottom bottom',
          onUpdate: (self) => setCurrent(Math.min(CHAPTERS.length - 1, Math.floor(self.progress * CHAPTERS.length))),
        })
      })
    },
    { scope: root },
  )

  const jump = useCallback((index: number) => {
    const el = root.current
    if (!el || !window.matchMedia(DESKTOP).matches) return
    const span = el.offsetHeight - window.innerHeight
    const top = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top + ((index + 0.5) / CHAPTERS.length) * span })
  }, [])

  const runs = (index: number) => onScreen && (!desktop || current === index)
  const panels = [
    <HostDeskPanel key="desk" />,
    <OpenRound key="open" active={runs(1)} />,
    <LateRound key="late" active={runs(2)} />,
    <SoldRound key="sold" active={runs(3)} />,
  ]

  return (
    <section id="lot" className="story" ref={root} aria-labelledby="story-title">
      <div className="story-pin">
        <div className="wrap story-grid">
          <h2 id="story-title" className="title story-heading">
            One lot, from the first word to the hammer
          </h2>
          {CHAPTERS.map((chapter, index) => (
            <div key={chapter.title} className="story-row" data-current={current === index}>
              <div className="story-chapter">
                <h3 className="story-title">
                  <button type="button" onClick={() => jump(index)} aria-current={current === index ? 'step' : undefined}>
                    {chapter.title}
                  </button>
                </h3>
                <div className="story-fold">
                  <p className="story-body">{chapter.body}</p>
                </div>
              </div>
              <div className={`story-plate plate plate--${chapter.tone}`}>
                <PaperTag className="story-plate-tag" />
                <i className="cube" style={{ left: '9%', bottom: '12%' }} aria-hidden="true" />
                <i className="cube" style={{ right: '11%', top: '9%' }} aria-hidden="true" />
                <AppSidebar still>{panels[index]}</AppSidebar>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
