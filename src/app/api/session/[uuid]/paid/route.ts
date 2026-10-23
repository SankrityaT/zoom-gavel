import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { hostKeyFor } from '@/lib/gavel/host'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { setRoundPaid } from '@/lib/gavel/server'
import { boundedInt, isSessionKey, rejectCrossSite } from '@/lib/gavel/validate'

// The host's own tally of who has paid. Gavel never sees the money, so this is
// a tick the host sets by hand, under the same rule as the queue (a co-host
// acts with the host's key). The winner's page shows the tick.
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/paid'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) return NextResponse.json({ error: 'invalid session key' }, { status: 400 })
  const crossSite = rejectCrossSite(request)
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
  }
  const payload = body as Record<string, unknown>
  const roundNo = boundedInt(payload.roundNo, 1)
  if (roundNo === null || typeof payload.paid !== 'boolean') {
    return NextResponse.json({ error: 'roundNo and paid are required' }, { status: 400 })
  }

  try {
    const limited = await enforce([rule(`payment:ip:${clientIp(request)}`, LIMITS.paymentPerIp)])
    if (limited) return limited
    const viewer = await readViewer(request, uuid)
    const host = await hostKeyFor(uuid, viewer)
    if ('refusal' in host) return host.refusal
    const outcome = await setRoundPaid(uuid, host.hostKey, roundNo, payload.paid)
    if (outcome.ok) return NextResponse.json({ ok: true, paid: outcome.paid })
    switch (outcome.reason) {
      case 'unverified':
        return NextResponse.json({ error: 'zoom identity required' }, { status: 401 })
      case 'not_host':
        return NextResponse.json({ error: 'not the host' }, { status: 403 })
      case 'not_found':
        return NextResponse.json({ error: 'no sold lot with that number' }, { status: 404 })
      default:
        return NextResponse.json({ error: 'not accepted' }, { status: 400 })
    }
  } catch (error) {
    console.error('paid route failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
