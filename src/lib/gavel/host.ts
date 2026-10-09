import { NextResponse } from 'next/server'
import type { Viewer } from './auth'
import { isSandboxKey } from './types'

// Who may run a session. Meeting sessions need a verified Zoom identity
// from that exact meeting, and SQL then holds them to the host rule;
// sandbox sessions (demo and join-link keys) are ownerless.
export function hostKeyFor(uuid: string, viewer: Viewer): { hostKey: string | null } | { refusal: NextResponse } {
  if (isSandboxKey(uuid)) return { hostKey: null }
  if (!viewer.verified) {
    return { refusal: NextResponse.json({ error: 'zoom identity required' }, { status: 401 }) }
  }
  if (!viewer.inThisMeeting) {
    return { refusal: NextResponse.json({ error: 'not in this meeting' }, { status: 403 }) }
  }
  return { hostKey: viewer.bidderKey }
}
