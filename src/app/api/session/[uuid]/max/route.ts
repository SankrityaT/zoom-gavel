import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { MAX_BID } from '@/lib/gavel/demo'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { getState, setMaxBid } from '@/lib/gavel/server'
import { anonBidderKey, boundedInt, boundedString, isSessionKey, rejectCrossSite } from '@/lib/gavel/validate'

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

// A bidder's max bid: the most they will pay this round. The server then
// bids for them, one step at a time, only as far as it takes to lead.
// `amount: null` removes it. Identity follows the same rule as a bid: the
// verified cookie when present, otherwise the hash of the chosen name.
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/max'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) return badRequest('invalid session key')
  const crossSite = rejectCrossSite(request)
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('body must be JSON')
  }
  const payload = body as Record<string, unknown>

  const clearing = payload.amount === null
  const amount = clearing ? null : boundedInt(payload.amount, 1)
  if (!clearing && amount === null) {
    return badRequest(`amount must be an integer between 1 and ${MAX_BID}, or null to remove`)
  }
  const bidderName = boundedString(payload.bidderId, 60)
  if (bidderName === null) return badRequest('bidderId is required')

  try {
    const viewer = await readViewer(request, uuid)
    const bidderKey = viewer.verified ? (viewer.bidderKey as string) : await anonBidderKey(bidderName)
    const limited = await enforce([
      rule(`bid:ip:${clientIp(request)}`, LIMITS.bidPerIp),
      rule(`bid:who:${uuid}:${bidderKey}`, LIMITS.bidPerBidder),
    ])
    if (limited) return limited

    const outcome = await setMaxBid(uuid, bidderKey, bidderName, viewer.verified, amount)
    const state = await getState(uuid, viewer)
    if (!outcome.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: outcome.reason,
          minAmount: outcome.min_amount,
          maxAllowed: outcome.max_allowed,
          state,
        },
        { status: outcome.reason === 'not_found' ? 404 : 409 },
      )
    }
    return NextResponse.json({ ok: true, max: outcome.max, state })
  } catch (error) {
    console.error('max bid route failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
