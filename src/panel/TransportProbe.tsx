'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

// Answers, from inside whatever client is running the app, the question
// the Zoom webview never let us settle: are WebSocket and EventSource
// present, and does a raw websocket handshake to Supabase get through?
// The handshake runs only on request, so the panel never talks to
// Supabase from inside Zoom unless someone asks it to.

type Outcome = 'not run' | 'checking' | 'open' | 'failed' | 'timeout' | 'throws' | 'missing' | 'n/a'

const HANDSHAKE_TIMEOUT_MS = 6000

function realtimeUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  return `${url.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${encodeURIComponent(anon)}&vsn=1.0.0`
}

function probeHandshake(onResult: (outcome: Outcome) => void) {
  const url = realtimeUrl()
  if (!url) {
    onResult('n/a')
    return () => {}
  }
  if (typeof WebSocket === 'undefined') {
    onResult('missing')
    return () => {}
  }
  let socket: WebSocket
  try {
    socket = new WebSocket(url)
  } catch {
    onResult('throws')
    return () => {}
  }
  let settled = false
  const finish = (outcome: Outcome) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    onResult(outcome)
    try {
      socket.close()
    } catch {
      // Ignore: the probe only needed the handshake result.
    }
  }
  const timer = setTimeout(() => finish('timeout'), HANDSHAKE_TIMEOUT_MS)
  socket.onopen = () => finish('open')
  socket.onerror = () => finish('failed')
  return () => finish('n/a')
}

// Stable snapshot for useSyncExternalStore; the server render has none,
// so the first client render matches it and fills in after hydration.
const clientGlobals = {
  webSocket: typeof WebSocket !== 'undefined',
  eventSource: typeof EventSource !== 'undefined',
}
const presence = (present: boolean | undefined) =>
  present === undefined ? 'checking' : present ? 'present' : 'missing'

export default function TransportProbe() {
  const [handshake, setHandshake] = useState<Outcome>('not run')
  const [runId, setRunId] = useState(0)
  const globals = useSyncExternalStore(
    () => () => {},
    () => clientGlobals,
    () => null,
  )

  useEffect(() => {
    if (runId === 0) return
    let active = true
    const cancel = probeHandshake((outcome) => {
      if (active) setHandshake(outcome)
    })
    return () => {
      active = false
      cancel()
    }
  }, [runId])

  return (
    <>
      <dl>
        <div>
          <dt>WebSocket</dt>
          <dd>{presence(globals?.webSocket)}</dd>
        </div>
        <div>
          <dt>EventSource</dt>
          <dd>{presence(globals?.eventSource)}</dd>
        </div>
        <div>
          <dt>Supabase wss</dt>
          <dd>{handshake}</dd>
        </div>
      </dl>
      <button
        className="button button--secondary"
        type="button"
        disabled={handshake === 'checking'}
        onClick={() => {
          setHandshake('checking')
          setRunId((n) => n + 1)
        }}
      >
        Test Supabase websocket
      </button>
    </>
  )
}
