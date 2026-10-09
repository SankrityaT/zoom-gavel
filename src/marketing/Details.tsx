'use client'

import { useEffect, useRef, useState } from 'react'
import { BID_STEP, DEMO_OPENING_BID, formatUsd } from '@/lib/gavel/demo'
import { Crop, DANA, GLASS_HORSE, MARCUS, PEOPLE, PRIYA, RoundPanel, Toast } from './demo'
import { ChapterHead, Tile } from './parts'
import { SELF, type SimEvent, useSimAuction } from './sim'

// A round the visitor is in but not leading, for the pictures below.
const BEHIND: SimEvent[] = [
  { at: 0, key: PRIYA.key, amount: 1000 },
  { at: 0, key: SELF.key, amount: 1050 },
  { at: 0, key: DANA.key, amount: 1100 },
  { at: 0, key: MARCUS.key, amount: 1150 },
]
const LEADING: SimEvent[] = [...BEHIND, { at: 0, key: SELF.key, amount: 1175 }]
const BOUGHT: SimEvent[] = [...BEHIND, { at: 0, key: SELF.key, amount: 2000 }]

function Still({ script, show, heldMax }: { script: SimEvent[]; show: ('tag' | 'bidders' | 'dock')[]; heldMax?: number }) {
  const { state, auction } = useSimAuction({
    lot: GLASS_HORSE,
    people: PEOPLE,
    script,
    asBidder: true,
    active: false,
    stillAt: 6000,
    heldMax,
  })
  return <RoundPanel state={state} auction={auction} show={show} />
}

// The measured range for tap to every other screen, and its midpoint. Each
// tap waits one of them, so the delay you feel is the real one.
const DELAYS = [265, 160, 370]
const RESET_AT = 2000

function Speed() {
  const [mine, setMine] = useState(DEMO_OPENING_BID)
  const [theirs, setTheirs] = useState(DEMO_OPENING_BID)
  const [landed, setLanded] = useState<number | null>(null)
  const [flying, setFlying] = useState(false)
  const taps = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const next = mine + BID_STEP >= RESET_AT ? DEMO_OPENING_BID : mine + BID_STEP

  function bid() {
    if (flying) return
    const delay = DELAYS[taps.current % DELAYS.length]
    taps.current += 1
    const started = performance.now()
    const amount = next
    setMine(amount)
    setFlying(true)
    setLanded(null)
    timer.current = setTimeout(() => {
      setTheirs(amount)
      setLanded(Math.round(performance.now() - started))
      setFlying(false)
    }, delay)
  }

  return (
    <div className="speed rise">
      <div className="speed-copy">
        <h3>On every screen in 160 to 370 milliseconds.</h3>
        <p>
          That is tap to every other panel, measured on the production deployment inside a meeting. Tap Bid and watch
          the other screen: each tap waits 160, 265 or 370 ms.
        </p>
      </div>
      <div className="speed-screens">
        <div className="speed-screen">
          <span className="speed-who">Your screen</span>
          <span className="speed-price">{formatUsd(mine)}</span>
          <button className="speed-bid" type="button" onClick={bid}>
            Bid {formatUsd(next)}
          </button>
        </div>
        <div className="speed-screen">
          <span className="speed-who">Everyone else&apos;s screen</span>
          <span className="speed-price">{formatUsd(theirs)}</span>
          <span className="speed-time" role="status">
            {landed === null ? (flying ? 'On its way' : 'Waiting for a bid') : `Landed in ${landed} ms`}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Details() {
  return (
    <section id="bidders" className="chapter" aria-labelledby="bidders-title">
      <ChapterHead
        id="bidders-title"
        label="For bidders"
        title="Fair to the room, and quick."
        lede="What a bidder can see, what Gavel does for them, and how fast a bid travels."
      />

      <div className="tiles rise">
        <Tile title="Amounts stay private." small="Everyone sees the ranking and the current price. Any other amount shows as a lock, except to the person who bid it and the host.">
          <Crop>
            <Still script={BEHIND} show={['bidders']} />
          </Crop>
        </Tile>
        <Tile title="A max bid does the tapping." small="Set the most you would pay. Gavel bids for you $25 at a time, and only as far as it takes to stay ahead.">
          <Crop>
            <Still script={LEADING} show={['dock']} heldMax={1400} />
          </Crop>
        </Tile>
        <Tile title="Buy Now ends it." small="Two taps take the lot at the host’s Buy Now price. If two people try at once, one gets it and the other finds the round closed.">
          <Crop>
            <Still script={BOUGHT} show={['tag']} />
          </Crop>
        </Tile>
        <Tile title="You are told the moment you are passed." small="A banner, and in a meeting a sound: when bidding opens, when you are outbid, through the last five seconds, and when the hammer falls.">
          <Crop className="crop--toast">
            <div className="gv">
              <Toast alert={{ id: 1, tone: 'outbid', title: "You've been outbid", detail: 'Marcus bid $1,175' }} onDismiss={() => undefined} />
              <Toast alert={{ id: 2, tone: 'good', title: 'You won it', detail: 'Glass horse for $1,300' }} onDismiss={() => undefined} />
            </div>
          </Crop>
        </Tile>
      </div>

      <Speed />
    </section>
  )
}
