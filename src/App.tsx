'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import AuctionPanel from './panel/AuctionPanel'
import { describeError, toSessionKey } from '@/lib/gavel/demo'
import type { CheckState } from './zoom'
import {
  configureZoomSdk,
  startCollaborateMode,
  subscribeToZoomEvents,
  zoomCapabilities,
  zoomSdkVersion,
} from './zoom'
import type { CollaborateEvent } from './zoom'

const FALLBACK_KEY_STORAGE = 'gavel-demo-session'

// Per-browser demo session id: two tabs in one browser share an auction,
// but strangers on the public site never share a row.
function readOrCreateFallbackKey() {
  try {
    const existing = window.localStorage.getItem(FALLBACK_KEY_STORAGE)
    if (existing) return existing
    const fresh = `demo-${crypto.randomUUID().slice(0, 8)}`
    window.localStorage.setItem(FALLBACK_KEY_STORAGE, fresh)
    return fresh
  } catch {
    return `demo-${crypto.randomUUID().slice(0, 8)}`
  }
}

// Cached so useSyncExternalStore gets a stable snapshot.
let cachedFallbackKey: string | null = null
function getFallbackKey() {
  if (cachedFallbackKey === null) cachedFallbackKey = readOrCreateFallbackKey()
  return cachedFallbackKey
}

// Optional ?session=<key> lets a plain browser join a specific auction,
// e.g. a phone bidding on a live meeting's session via the host's share
// link. Keys are base64url or demo ids, so anything else is rejected.
const SESSION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,200}$/
let cachedJoinKey: string | null | undefined
function getJoinKey() {
  if (cachedJoinKey === undefined) {
    const raw = new URLSearchParams(window.location.search).get('session')
    cachedJoinKey = raw && SESSION_KEY_PATTERN.test(raw) ? raw : null
  }
  return cachedJoinKey
}

function App() {
  const [check, setCheck] = useState<CheckState>({ phase: 'checking' })
  const [collaborateEvent, setCollaborateEvent] =
    useState<CollaborateEvent | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  // SSR-safe, lint-clean read of the per-browser demo key.
  const fallbackKey = useSyncExternalStore(
    () => () => {},
    getFallbackKey,
    () => null,
  )
  const joinKey = useSyncExternalStore(
    () => () => {},
    getJoinKey,
    () => null,
  )

  // Async half of the check: every setState here happens after an await,
  // so it is safe to call from the mount effect.
  const performCheck = useCallback(async (force: boolean) => {
    try {
      const data = await configureZoomSdk({ force })
      setCheck({ phase: 'connected', data })
    } catch (error) {
      setCheck({ phase: 'disconnected', error: describeError(error) })
    }
  }, [])

  const runSdkCheck = useCallback(
    (options?: { force?: boolean }) => {
      setCheck({ phase: 'checking' })
      setActionMessage('')
      return performCheck(options?.force ?? false)
    },
    [performCheck],
  )

  useEffect(() => {
    // Initial state is already 'checking'; only the async part runs here,
    // with a guard so a slow result cannot land after unmount.
    let active = true

    async function initialCheck() {
      try {
        const data = await configureZoomSdk({ force: false })
        if (active) setCheck({ phase: 'connected', data })
      } catch (error) {
        if (active) setCheck({ phase: 'disconnected', error: describeError(error) })
      }
    }

    void initialCheck()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (check.phase !== 'connected') return

    return subscribeToZoomEvents({
      onCollaborateChange: (event) => {
        setCollaborateEvent(event)
        setActionMessage('')
      },
      onRunningContextChange: () => void runSdkCheck({ force: true }),
    })
  }, [check.phase, runSdkCheck])

  const diagnostics = check.phase === 'connected' ? check.data : null
  const context = diagnostics?.config.runningContext ?? 'browser preview'
  const isMeeting = diagnostics
    ? ['inMeeting', 'inCollaborate'].includes(diagnostics.config.runningContext)
    : false
  const unsupportedCount = diagnostics?.config.unsupportedApis.length ?? 0
  const checkMessage =
    check.phase === 'checking'
      ? 'Calling zoomSdk.config()...'
      : check.phase === 'connected'
        ? 'Zoom Apps SDK configured successfully.'
        : check.error

  // The auction session is keyed by the meeting UUID: unlike the
  // Collaborate UUID (which only the host's start event carries), every
  // in-meeting participant, including guests, can read it. Outside a
  // meeting, a per-browser demo key keeps strangers off each other's rows.
  const meetingUuid = diagnostics?.meeting?.meetingUUID ?? null
  const sessionKey = meetingUuid
    ? `mtg-${toSessionKey(meetingUuid)}`
    : (joinKey ?? fallbackKey)
  const sessionLabel = meetingUuid
    ? 'Meeting session'
    : joinKey
      ? 'Joined session'
      : 'Browser test session'

  // Unique-enough bidder identity: readable name plus a stable
  // participant-scoped suffix so duplicate screen names stay distinct.
  const bidderId = useMemo(() => {
    const name = diagnostics?.user?.screenName?.trim() || 'Guest'
    const suffix =
      diagnostics?.user?.participantUUID?.slice(0, 6) ??
      fallbackKey?.slice(-6) ??
      'local'
    return `${name} · ${suffix}`
  }, [diagnostics, fallbackKey])

  const readiness = [
    {
      label: 'React shell',
      detail: 'Running',
      ready: true,
    },
    {
      label: 'Zoom SDK config',
      detail: check.phase === 'connected' ? 'Connected' : 'Waiting for Zoom',
      ready: check.phase === 'connected',
    },
    {
      label: 'Meeting identity',
      detail: diagnostics?.meeting ? 'Available' : 'Open inside a meeting',
      ready: Boolean(diagnostics?.meeting),
    },
  ]

  // Per-capability pass/fail: the SDK config response lists which of the
  // declared capabilities this client does not support.
  const capabilityChecks = zoomCapabilities.map((name) => ({
    name,
    supported: diagnostics
      ? !diagnostics.config.unsupportedApis.includes(name)
      : null,
  }))

  async function handleStartCollaborate() {
    setActionMessage('Starting Collaborate Mode...')
    try {
      await startCollaborateMode()
      setActionMessage(
        'Start request accepted. Waiting for the Collaborate event...',
      )
    } catch (error) {
      setActionMessage(`Could not start: ${describeError(error)}`)
    }
  }

  return (
    <main className="app-shell">
      <section className="app-panel" aria-labelledby="page-title">
        <header className="topbar">
          <Link className="wordmark" href="/" aria-label="Zoom Gavel home">
            <span>zoom</span> Gavel
          </Link>
          <span className="build-tag">WEEK 1</span>
        </header>

        <div className="hero-copy">
          <p className="eyebrow">SDK BOILERPLATE</p>
          <h1 id="page-title">
            Ready for
            <br />
            <span>the room.</span>
          </h1>
          <p className="intro">
            Live bid state syncs across every participant below; SDK
            diagnostics follow.
          </p>
        </div>

        <div className="context-strip" aria-live="polite">
          <span
            className={`signal signal--${check.phase}`}
            aria-hidden="true"
          />
          <div>
            <span className="context-label">CURRENT CONTEXT</span>
            <strong>{context}</strong>
          </div>
          <span className="sdk-tag">SDK {zoomSdkVersion}</span>
        </div>

        {/* Mount only after the SDK check settles: forcePolling must be
            final before any sync transport initializes, because inside the
            Zoom webview the realtime path must never run at all. */}
        {check.phase !== 'checking' && sessionKey && (
          <AuctionPanel
            key={sessionKey}
            sessionKey={sessionKey}
            sessionLabel={sessionLabel}
            bidderName={bidderId}
            forcePolling={Boolean(diagnostics)}
            roleHint={diagnostics?.user?.role ?? null}
          />
        )}

        <section className="checklist" aria-labelledby="checklist-title">
          <div className="section-heading">
            <h2 id="checklist-title">Connection check</h2>
            <span>{readiness.filter((item) => item.ready).length}/3</span>
          </div>

          <ol>
            {readiness.map((item) => (
              <li key={item.label}>
                <span
                  className={`checkmark ${item.ready ? 'checkmark--ready' : ''}`}
                  aria-hidden="true"
                >
                  {item.ready ? '✓' : '·'}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="diagnostic" aria-labelledby="diagnostic-title">
          <div>
            <p className="context-label" id="diagnostic-title">
              DIAGNOSTIC
            </p>
            <p>{checkMessage}</p>
          </div>
          {diagnostics && (
            <dl>
              <div>
                <dt>Client</dt>
                <dd>{diagnostics.config.clientVersion}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{diagnostics.user?.role ?? 'Not available'}</dd>
              </div>
              <div>
                <dt>Unsupported</dt>
                <dd>{unsupportedCount}</dd>
              </div>
              <div>
                <dt>Collaborate ID</dt>
                <dd>{collaborateEvent?.collaborateUUID ?? 'Not started'}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="capabilities" aria-labelledby="capabilities-title">
          <div className="section-heading">
            <p className="context-label" id="capabilities-title">
              CAPABILITIES
            </p>
            <span>
              {diagnostics
                ? `${capabilityChecks.filter((c) => c.supported).length}/${capabilityChecks.length} supported`
                : 'Pending Zoom connection'}
            </span>
          </div>
          <ul className="capability-list">
            {capabilityChecks.map((cap) => (
              <li key={cap.name}>
                <span
                  className={
                    cap.supported === null
                      ? 'capability-dot'
                      : cap.supported
                        ? 'capability-dot capability-dot--pass'
                        : 'capability-dot capability-dot--fail'
                  }
                  aria-hidden="true"
                />
                <code>{cap.name}</code>
                <span className="capability-status">
                  {cap.supported === null
                    ? 'pending'
                    : cap.supported
                      ? 'pass'
                      : 'fail'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => void handleStartCollaborate()}
            disabled={!isMeeting || check.phase === 'checking'}
          >
            Start Collaborate test
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void runSdkCheck()}
            disabled={check.phase === 'checking'}
          >
            Run check again
          </button>
        </div>

        {actionMessage && (
          <p className="action-message" role="status">
            {actionMessage}
          </p>
        )}

        <footer>
          <span>{zoomCapabilities.length} capabilities declared</span>
          <span>Bid state syncs via Supabase Realtime</span>
        </footer>
      </section>
    </main>
  )
}

export default App
