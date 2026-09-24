import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { MAX_BID } from '@/lib/gavel/demo'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { ensureSession, getState, placeBid } from '@/lib/gavel/server'
import { anonBidderKey, boundedInt, boundedString, rejectCrossSite } from '@/lib/gavel/validate'

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function serverError(error: unknown) {
  console.error('session route failed:', error)
  return NextResponse.json({ error: 'internal error' }, { status: 500 })
}

export async function GET(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]'>,
) {
  const { uuid } = await params
  try {
    const viewer = await readViewer(request, uuid)
    const state = await getState(uuid, viewer)
    if (!state) {
      return NextResponse.json({ error: 'session not found' }, { status: 404 })
    }
    return NextResponse.json(state)
  } catch (error) {
    return serverError(error)
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]'>,
) {
  const { uuid } = await params
  if (!uuid || uuid.length > 200) return badRequest('invalid session key')
  const crossSite = rejectCrossSite(request)
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest('body must be JSON')
  }
  const payload = body as Record<string, unknown>

  try {
    const viewer = await readViewer(request, uuid)

    if ('init' in payload) {
      // Strict operation separation: an init request must be exactly an
      // init request, so a bid that accidentally carries the flag fails
      // loudly instead of being silently dropped.
      if (payload.init !== true) return badRequest('init must be true')
      if ('amount' in payload || 'bidderId' in payload) {
        return badRequest('init and bid are separate operations')
      }
      const itemName = boundedString(payload.itemName, 120) ?? 'Test lot'
      const openingBid = boundedInt(payload.openingBid, 0) ?? 0
      const limited = await enforce([rule(`init:ip:${clientIp(request)}`, LIMITS.initPerIp)])
      if (limited) return limited
      await ensureSession(uuid, itemName, openingBid)
      const state = await getState(uuid, viewer)
      return NextResponse.json(state, { status: 201 })
    }

    const amount = boundedInt(payload.amount, 1)
    if (amount === null) {
      return badRequest(`amount must be an integer between 1 and ${MAX_BID}`)
    }
    // bidderId is the display name; identity comes from the verified cookie
    // when present, otherwise a non-secret hash of the client-chosen name.
    const bidderName = boundedString(payload.bidderId, 60)
    if (bidderName === null) return badRequest('bidderId is required')

    const bidderKey = viewer.verified
      ? (viewer.bidderKey as string)
      : await anonBidderKey(bidderName)

    const limited = await enforce([
      rule(`bid:ip:${clientIp(request)}`, LIMITS.bidPerIp),
      rule(`bid:who:${uuid}:${bidderKey}`, LIMITS.bidPerBidder),
    ])
    if (limited) return limited

    const outcome = await placeBid(uuid, amount, bidderKey, bidderName, viewer.verified)
    const state = await getState(uuid, viewer)

    if (!outcome.ok) {
      return NextResponse.json(
        {
          accepted: false,
          reason: outcome.reason,
          minAmount: outcome.min_amount,
          state,
        },
        { status: 409 },
      )
    }
    return NextResponse.json({ accepted: true, extended: outcome.extended, state })
  } catch (error) {
    return serverError(error)
  }
}
