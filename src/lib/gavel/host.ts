import { NextResponse } from 'next/server'
import type { Viewer } from './auth'
import { getRawState } from './server'
import { isSandboxKey } from './types'

// Who may run a session. Meeting sessions need a verified Zoom identity
// from that exact meeting, and SQL then holds them to the host rule;
// sandbox sessions (demo and join-link keys) are ownerless.
//
// A co-host (named by Zoom, recorded by the webhook) acts with the host's own
// key. SQL only knows one host, and starting a round stamps the starter as
// host, so a co-host passing their own key would either be refused or take the
// claim from the real host. If the host changes between this read and the
// action, the host's old key no longer matches and SQL refuses it.
export async function hostKeyFor(
  uuid: string,
  viewer: Viewer,
): Promise<{ hostKey: string | null } | { refusal: NextResponse }> {
  if (isSandboxKey(uuid)) return { hostKey: null }
  if (!viewer.verified) {
    return { refusal: NextResponse.json({ error: 'zoom identity required' }, { status: 401 }) }
  }
  if (!viewer.inThisMeeting) {
    return { refusal: NextResponse.json({ error: 'not in this meeting' }, { status: 403 }) }
  }
  const raw = await getRawState(uuid, viewer.bidderKey)
  if (raw?.viewer_cohost === true && raw.session.host_key) {
    return { hostKey: raw.session.host_key }
  }
  return { hostKey: viewer.bidderKey }
}
