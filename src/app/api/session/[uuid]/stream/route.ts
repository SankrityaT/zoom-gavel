import { NextResponse } from 'next/server'
import { readViewer } from '@/lib/gavel/auth'
import { LIMITS, clientIp, enforce, rule } from '@/lib/gavel/rate-limit'
import { subscribeSession, type HubEvent } from '@/lib/gavel/realtime-hub'
import { getState } from '@/lib/gavel/server'
import { isSessionKey } from '@/lib/gavel/validate'

// Server-Sent Events push for clients that cannot hold a websocket to
// Supabase themselves, i.e. the Zoom webview, whose domain allow list and
// websocket support we do not control. Same origin, plain HTTP, so no
// allow-list entry and no CSP change.
//
// Protocol: `state` (full viewer-specific snapshot) right after the
// upstream channel is live, then `session` / `bid` deltas, `: ping`
// heartbeats, and a clean close before maxDuration. EventSource reconnects
// by itself and every connection starts with a fresh snapshot, so nothing
// is lost across the reconnect. `fallback` tells the client to poll.

export const maxDuration = 300

const STREAM_MS = 270_000
const HEARTBEAT_MS = 15_000
const READY_TIMEOUT_MS = 10_000

export async function GET(
  request: Request,
  { params }: RouteContext<'/api/session/[uuid]/stream'>,
) {
  const { uuid } = await params
  if (!isSessionKey(uuid)) {
    return NextResponse.json({ error: 'invalid session key' }, { status: 400 })
  }
  const limited = await enforce([rule(`stream:ip:${clientIp(request)}`, LIMITS.streamPerIp)])
  if (limited) return limited

  const viewer = await readViewer(request, uuid)
  const encoder = new TextEncoder()
  let stop: () => void = () => {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false

      function close() {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        clearTimeout(deadline)
        subscription.unsubscribe()
        request.signal.removeEventListener('abort', close)
        try {
          controller.close()
        } catch {
          // Already closed by the runtime.
        }
      }

      function send(chunk: string) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          close()
        }
      }

      function event(name: string, data: unknown) {
        send(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      const subscription = subscribeSession(uuid, (hubEvent: HubEvent) => {
        if (hubEvent.type === 'down') close()
        else event(hubEvent.type, hubEvent)
      })
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
      const deadline = setTimeout(close, STREAM_MS)
      stop = close
      send('retry: 1000\n\n')
      request.signal.addEventListener('abort', close)
      if (request.signal.aborted) close()

      let readyTimer: ReturnType<typeof setTimeout> | undefined
      const ready = await Promise.race([
        subscription.ready,
        new Promise<boolean>((resolve) => {
          readyTimer = setTimeout(() => resolve(false), READY_TIMEOUT_MS)
        }),
      ])
      clearTimeout(readyTimer)
      if (closed) return
      if (!ready) {
        event('fallback', { reason: 'upstream unavailable' })
        close()
        return
      }

      // Snapshot after the channel is live: anything that changes between
      // the two arrives as a delta, and the client's updatedAt guard
      // discards whichever copy is older.
      try {
        event('state', await getState(uuid, viewer))
      } catch (error) {
        console.error('stream snapshot failed:', error)
        event('fallback', { reason: 'snapshot failed' })
        close()
      }
    },
    cancel() {
      stop()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
