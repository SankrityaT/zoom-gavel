'use client'

import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
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
import { DESKTOP, ScrollTrigger, useGSAP } from './motion'
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

const CHAPTERS: { title: string; body: ReactNode }[] = [
  {
    title: 'The host says what is for sale',
    body: (
      <>
        A lot is set up as a sentence: the item, where bidding starts, a reserve if there is one, and a Buy Now price
        if the host wants to offer it. Rounds run 30 seconds, 1 minute, 2 minutes or 5. Start the lot right away, or
        add it to the queue and run the night in order.
      </>
    ),
  },
  {
    title: 'Everyone bids from the side panel',
    body: (
      <>
        The price is the largest thing on the screen. One tap bids the next $25, the plus and minus keys go higher,
        and any amount can be typed. Measured on the production deployment, a bid reached the other screens in 160 to
        370 milliseconds.
      </>
    ),
  },
  {
    title: 'A late bid adds time',
    body: (
      <>
        A bid in the last 10 seconds moves the deadline to 15 seconds after it, so nobody wins by waiting for the
        final second. The deadline lives on the server and every panel counts down to the same instant. If someone
        passes you, the panel says so at once.
      </>
    ),
  },
  {
    title: 'The hammer falls',
    body: (
      <>
        When the clock runs out the lot is stamped Sold, or marked not sold if the reserve was never met. The host
        sees every amount and keeps a receipt of the night, with a CSV to download for collecting payment afterward.
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

  useGSAP(
    () => {
      const chapters = Array.from(root.current?.querySelectorAll<HTMLElement>('.story-chapter') ?? [])
      chapters.forEach((chapter, index) => {
        ScrollTrigger.create({
          trigger: chapter,
          start: 'top 58%',
          end: 'bottom 58%',
          onToggle: (self) => {
            if (self.isActive) setCurrent(index)
          },
        })
      })
    },
    { scope: root },
  )

  // On a wide screen one sidebar stays put and only the current chapter's
  // round runs. On a phone each chapter carries its own.
  const runs = (index: number) => onScreen && (!desktop || current === index)
  const panels = [
    <HostDeskPanel key="desk" />,
    <OpenRound key="open" active={runs(1)} />,
    <LateRound key="late" active={runs(2)} />,
    <SoldRound key="sold" active={runs(3)} />,
  ]

  return (
    <section id="lot" className="story" ref={root} aria-labelledby="story-title">
      <div className="wrap">
        <h2 id="story-title" className="title" data-lines>
          <span className="mask">
            <span className="line">One lot, from the first word</span>
          </span>
          <span className="mask">
            <span className="line">to the hammer</span>
          </span>
        </h2>

        <div className="story-grid">
          {CHAPTERS.map((chapter, index) => (
            <div key={chapter.title} className="story-row" data-current={current === index}>
              <div className="story-chapter">
                <span className="story-no" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="story-title">{chapter.title}</h3>
                <p className="story-body">{chapter.body}</p>
              </div>
              <div className="story-panel">
                <AppSidebar still>{panels[index]}</AppSidebar>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
