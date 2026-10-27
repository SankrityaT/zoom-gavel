import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { formatUsd } from '@/lib/gavel/demo'
import { payLinkFrom } from '@/lib/gavel/paylink'
import { LIMITS, clientIp, rule } from '@/lib/gavel/rate-limit'
import { rateLimitHit, winnerPage } from '@/lib/gavel/server'
import { SUPPORT_EMAIL } from '@/legal/contact'
import './winner.css'

// A winner's private page. The address is a random token only the winner holds
// (their panel hands it to them), so the page needs no sign-in and works in
// any browser after the meeting. It shows what they owe and where the host
// asked them to send it. Gavel never takes the payment and cannot see it.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your win',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const TOKEN = /^[A-Za-z0-9_-]{24,64}$/

function day(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default async function WinnerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!TOKEN.test(token)) notFound()

  const ip = clientIp({ headers: await headers() } as Request)
  let retryAfter = 0
  try {
    retryAfter = await rateLimitHit([{ ...rule(`winpage:ip:${ip}`, LIMITS.winnerPagePerIp) }])
  } catch {
    // The limiter failing must not hide someone's payment details.
  }
  if (retryAfter > 0) {
    return (
      <main className="wp">
        <p className="wp-brand">Gavel</p>
        <h1>One moment</h1>
        <p className="wp-sub">Too many people are opening this page. Try again in a minute.</p>
      </main>
    )
  }

  const page = await winnerPage(token)
  if (!page || page.wins.length === 0) notFound()

  const { wins, note } = page
  const owed = wins.filter((win) => !win.paid).reduce((sum, win) => sum + win.final_bid, 0)
  const total = wins.reduce((sum, win) => sum + win.final_bid, 0)
  const allPaid = owed === 0
  const link = payLinkFrom(note)
  const latest = wins.reduce((a, b) => (a > b.closed_at ? a : b.closed_at), wins[0].closed_at)

  return (
    <main className="wp">
      <p className="wp-brand">Gavel</p>
      {wins.length === 1 && wins[0].photo_id && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wp-photo" src={`/api/photo/${wins[0].photo_id}`} alt={`Photo of ${wins[0].item_name}`} />
      )}
      <h1>{wins.length === 1 ? `You won the ${wins[0].item_name}` : `You won ${wins.length} lots`}</h1>
      <p className="wp-sub">Winning {wins.length === 1 ? 'bid' : 'bids'}, from the auction on {day(latest)}.</p>

      {allPaid ? (
        <p className="wp-done">The host has marked this as paid. Nothing more to do.</p>
      ) : (
        <>
          <p className="wp-owe">
            <small>You owe the host</small>
            <b>{formatUsd(owed)}</b>
          </p>
          {link && (
            <a className="wp-go" href={link.url} rel="noopener noreferrer nofollow" target="_blank">
              Pay {formatUsd(owed)} with {link.service}
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 4h9v9M16 4 6 14" />
              </svg>
            </a>
          )}
          {note ? (
            <p className="wp-alt">
              {link ? 'Or send it to ' : 'Send it to '}
              <code>{note}</code>
            </p>
          ) : (
            <p className="wp-alt">The host has not said how to pay yet. Ask them in the meeting or its chat.</p>
          )}
        </>
      )}

      <section className="wp-receipt" aria-label="Your lots">
        <h2>Your lots</h2>
        <ul>
          {wins.map((win) => (
            <li key={win.round_no}>
              <span>
                {wins.length > 1 && win.photo_id && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="wp-thumb" src={`/api/photo/${win.photo_id}`} alt="" />
                )}
                {win.item_name}
                {win.paid && <em>Paid</em>}
              </span>
              <span>{formatUsd(win.final_bid)}</span>
            </li>
          ))}
        </ul>
        <p className="wp-total">
          <span>Total</span>
          <span>{formatUsd(total)}</span>
        </p>
      </section>

      <p className="wp-fine">
        This page stays open until <b>{day(page.expires_at)}</b>, so you can pay after the meeting ends. Gavel does not take payment and cannot see it. Check this is the person you
        expect before you send anything. Something wrong? <a href={`mailto:${SUPPORT_EMAIL}?subject=Gavel%20winner%20page`}>{SUPPORT_EMAIL}</a>
      </p>
    </main>
  )
}
