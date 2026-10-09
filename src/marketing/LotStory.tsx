'use client'

import { useRef, type ReactNode } from 'react'
import {
  Crop,
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
import { ChapterHead, Frame } from './parts'
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
  return <RoundPanel state={state} auction={auction} show={['tag', 'bidders']} />
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
  return <RoundPanel state={state} auction={auction} show={['tag', 'dock']} />
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
    <RoundPanel state={state} auction={auction} show={['tag']}>
      <ReceiptSlip lots={1} />
    </RoundPanel>
  )
}

/** One step of the lot: a picture of the panel on the lot's photograph, and what it shows. */
function Step({
  title,
  at,
  flip,
  children,
  show,
}: {
  title: string
  at: string
  flip?: boolean
  children: ReactNode
  show: (active: boolean) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(ref)
  return (
    <div className={flip ? 'step step--flip rise' : 'step rise'} ref={ref}>
      <Frame at={at} className="step-frame">
        <Crop>{show(onScreen)}</Crop>
      </Frame>
      <div className="step-copy">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  )
}

export default function LotStory() {
  return (
    <section id="lot" className="chapter" aria-labelledby="lot-title">
      <ChapterHead
        id="lot-title"
        label="How a lot goes"
        title="One lot, from the first word to the hammer."
        lede="The host runs the sale from the same side panel the bidders use. Each lot is a round with a clock."
      />

      <div className="steps">
        <Step title="The host says what is for sale." at="6% 86%" show={() => <HostDeskPanel />}>
          A lot is set up as a sentence: the item, where bidding starts, a reserve if there is one, and a Buy Now
          price if the host wants one. Start it now, or line the night up in the queue.
        </Step>
        <Step title="Everyone bids from the side panel." at="30% 96%" flip show={(active) => <OpenRound active={active} />}>
          The price is the largest thing on the screen, with who holds it under it. The board below reorders as
          bids land.
        </Step>
        <Step title="A late bid adds time." at="0% 60%" show={(active) => <LateRound active={active} />}>
          A bid in the last 10 seconds moves the deadline to 15 seconds after it, so nobody wins by waiting for the
          final second. The deadline lives on the server and every panel counts down to the same instant.
        </Step>
        <Step title="The hammer falls." at="18% 100%" flip show={(active) => <SoldRound active={active} />}>
          The clock stops and the lot is stamped Sold, or marked not sold if the reserve was never met. The host
          keeps a receipt of the night, with a CSV to download for collecting payment afterward.
        </Step>
      </div>

      <div className="facts rise">
        <div>
          <h4>Reserve and Buy Now</h4>
          <p>Both are optional, per lot. Buy Now can never sell below the reserve.</p>
        </div>
        <div>
          <h4>Rounds from 30 seconds to 5 minutes</h4>
          <p>The host picks the length when the lot is set up, and can end a round early.</p>
        </div>
        <div>
          <h4>Only the host runs the sale</h4>
          <p>Zoom tells the server who started the meeting, and every host action is checked against it.</p>
        </div>
      </div>
    </section>
  )
}
