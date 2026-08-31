'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ZoomDiagnostics, CollaborateEvent } from './zoom'
import {
  configureZoomSdk,
  startCollaborateMode,
  subscribeToZoomEvents,
  zoomCapabilities,
  zoomSdkVersion,
} from './zoom'

type CheckState =
  | { phase: 'checking'; data: null; message: string }
  | { phase: 'connected'; data: ZoomDiagnostics; message: string }
  | { phase: 'disconnected'; data: null; message: string }

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown Zoom SDK error'
  }
}

function App() {
  const [check, setCheck] = useState<CheckState>({
    phase: 'checking',
    data: null,
    message: 'Calling zoomSdk.config()...',
  })
  const [collaborateEvent, setCollaborateEvent] =
    useState<CollaborateEvent | null>(null)
  const [actionMessage, setActionMessage] = useState('')

  const completeSdkCheck = useCallback(async () => {
    try {
      const data = await configureZoomSdk({ force: true })
      setCheck({
        phase: 'connected',
        data,
        message: 'Zoom Apps SDK configured successfully.',
      })
    } catch (error) {
      setCheck({
        phase: 'disconnected',
        data: null,
        message: errorMessage(error),
      })
    }
  }, [])

  const runSdkCheck = useCallback(async () => {
    setCheck({
      phase: 'checking',
      data: null,
      message: 'Calling zoomSdk.config()...',
    })
    setActionMessage('')
    await completeSdkCheck()
  }, [completeSdkCheck])

  useEffect(() => {
    let active = true

    configureZoomSdk()
      .then((data) => {
        if (!active) return
        setCheck({
          phase: 'connected',
          data,
          message: 'Zoom Apps SDK configured successfully.',
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        setCheck({
          phase: 'disconnected',
          data: null,
          message: errorMessage(error),
        })
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (check.phase !== 'connected') return

    return subscribeToZoomEvents({
      onCollaborateChange: (event) => setCollaborateEvent(event),
      onRunningContextChange: () => void runSdkCheck(),
    })
  }, [check.phase, runSdkCheck])

  const context = check.data?.config.runningContext ?? 'browser preview'
  const isMeeting = check.data
    ? ['inMeeting', 'inCollaborate'].includes(
        check.data.config.runningContext,
      )
    : false
  const unsupportedCount = check.data?.config.unsupportedApis.length ?? 0
  const readiness = useMemo(
    () => [
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
        detail: check.data?.meeting ? 'Available' : 'Open inside a meeting',
        ready: Boolean(check.data?.meeting),
      },
    ],
    [check],
  )

  async function handleStartCollaborate() {
    setActionMessage('Starting Collaborate Mode...')
    try {
      await startCollaborateMode()
      setActionMessage(
        'Start request accepted. Waiting for the Collaborate event...',
      )
    } catch (error) {
      setActionMessage(`Could not start: ${errorMessage(error)}`)
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
            A clean starting point for validating Zoom context before live
            bidding state is added.
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
            <p>{check.message}</p>
          </div>
          {check.data && (
            <dl>
              <div>
                <dt>Client</dt>
                <dd>{check.data.config.clientVersion}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{check.data.user?.role ?? 'Not available'}</dd>
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
          <span>No bid state is synced yet</span>
        </footer>
      </section>
    </main>
  )
}

export default App
