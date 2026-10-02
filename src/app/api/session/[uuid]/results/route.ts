import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { resultsCsv } from '@/lib/gavel/results'
import { getRounds, getState } from '@/lib/gavel/server'
import { toRoundResult } from '@/lib/gavel/types'
import { isSessionKey } from '@/lib/gavel/validate'

// Finished rounds for a session: JSON by default, a spreadsheet-safe CSV
// with ?format=csv. On meeting sessions this is the host's record of who
// owes what, so only the host may read it. Sandbox sessions have no host.
export async function GET(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/results'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) {
    return NextResponse.json({ error: 'invalid session key' }, { status: 400 })
  }
  const limited = await enforce([rule(`results:ip:${clientIp(request)}`, LIMITS.resultsPerIp)])
  if (limited) return limited

  try {
    const viewer = await readViewer(request, uuid)
    // Also closes an expired round, so a just-finished lot is included.
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

    const rounds = (await getRounds(uuid)).map(toRoundResult)
    if (new URL(request.url).searchParams.get('format') === 'csv') {
      return new Response(resultsCsv(rounds), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="gavel-results.csv"',
          'Cache-Control': 'no-store',
        },
      })
    }
    return NextResponse.json({ rounds }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('results route failed:', error)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
