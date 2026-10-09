'use client'

import { useRef, useState } from 'react'
import { formatUsd } from '@/lib/gavel/demo'
import { AppSidebar, DANA, GLASS_HORSE, MARCUS, PEOPLE, PRIYA, RoundPanel, useOnScreen } from './demo'
import { ChapterHead, Frame } from './parts'
import { type SimRival, useSimAuction } from './sim'

// How far each pretend bidder will go. Bid past the last of them and the
// horse is yours.
const RIVALS: SimRival[] = [
  { key: PRIYA.key, ceiling: 1150 },
  { key: DANA.key, ceiling: 1200 },
  { key: MARCUS.key, ceiling: 1275 },
]

export default function Paddle() {
  const root = useRef<HTMLElement>(null)
  const onScreen = useOnScreen(root)
  const [asHost, setAsHost] = useState(false)
  const { state, auction, restart } = useSimAuction({
    lot: GLASS_HORSE,
    people: PEOPLE,
    rivals: RIVALS,
    viewer: asHost ? 'host' : 'bidder',
    asBidder: true,
    persistent: true,
    active: onScreen,
    stillAt: 0,
  })
  const { session } = state
  const closed = session.status === 'closed'
  const sold = closed && session.leader !== null && session.reserveMet
  const won = sold && session.leader?.bidderKey === auction.selfKey

  return (
    <section id="paddle" className="chapter" ref={root} aria-labelledby="paddle-title">
      <ChapterHead
        id="paddle-title"
        label="Try bidding"
        title="Bid on the glass horse."
        lede="This is the panel a bidder gets in the meeting, running against three pretend bidders in your browser. Nothing you do here is sent anywhere."
      />

      <Frame at="50% 58%" zoom={1} className="paddle-frame rise">
        <div className="paddle-side">
          <p className="paddle-result" role="status">
            {closed
              ? won
                ? `Yours for ${formatUsd(session.currentBid)}.`
                : sold
                  ? `${session.leader?.name} took it for ${formatUsd(session.currentBid)}.`
                  : 'It did not sell this time.'
              : asHost
                ? 'You are seeing what the host sees: every amount.'
                : 'You are seeing what a bidder sees.'}
          </p>
          <div className="paddle-buttons">
            <button className="chip" type="button" aria-pressed={asHost} onClick={() => setAsHost((on) => !on)}>
              {asHost ? 'See it as a bidder' : 'See it as the host'}
            </button>
            <button className={closed ? 'chip chip--ink' : 'chip'} type="button" onClick={restart}>
              {closed ? 'Run the lot again' : 'Start over'}
            </button>
          </div>
        </div>
        <AppSidebar className="paddle-panel">
          <RoundPanel state={state} auction={auction} alerts />
        </AppSidebar>
      </Frame>
    </section>
  )
}
