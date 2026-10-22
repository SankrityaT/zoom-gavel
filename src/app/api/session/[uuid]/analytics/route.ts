import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { getAnalytics, getState } from '@/lib/gavel/server'
import { isSessionKey } from '@/lib/gavel/validate'

// The host's numbers for the night: what was raised, how many different people
// bid, and where in a lot bidders tend to drop out. Same gate as the results:
// the host (or a co-host) on a meeting, anyone on a practice room. Counts only,
// so it carries nothing that names a bidder.
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/analytics'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) {
    return NextResponse.json({ error: 'invalid session key' }, { status: 400 })
  }
  const limited = await enforce([rule(`results:ip:${clientIp(request)}`, LIMITS.resultsPerIp)])
  if (limited) return limited

  try {
    const viewer = await readViewer(request, uuid)
    // Also closes an expired round, so a lot that just finished is counted.
    const state = await getState(uuid, viewer)
    if (!state) return NextResponse.json({ error: 'session not found' }, { status: 404 })
    if (!state.session.sandbox) {
      if (!viewer.verified) {
        return NextResponse.json({ error: 'zoom identity required' }, { status: 401 })
      }
      if (!state.viewer.isHost) {
        return NextResponse.json({ error: 'not the host' }, { status: 403 })
      }
    }
    return NextResponse.json(await getAnalytics(uuid), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('analytics route failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
