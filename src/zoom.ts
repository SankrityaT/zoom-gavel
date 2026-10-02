import zoomSdk, {
  type Apis,
  type ConfigOptions,
  type ConfigResponse,
  type GetMeetingUUIDResponse,
  type GetUserContextResponse,
  type OnCollaborateChangeEvent,
} from '@zoom/appssdk'

export const zoomCapabilities = [
  'getRunningContext',
  'getUserContext',
  'getMeetingUUID',
  'startCollaborate',
  'onCollaborateChange',
  'onRunningContextChange',
  'getAppContext',
] satisfies Apis[]

export const zoomSdkVersion =
  process.env.NEXT_PUBLIC_ZOOM_SDK_VERSION ?? '0.16'

export type ZoomDiagnostics = {
  config: ConfigResponse
  meeting: GetMeetingUUIDResponse | null
  user: GetUserContextResponse | null
  /** Whether the server accepted this client's Zoom identity just now. */
  identity: 'established' | 'unavailable'
}

export type CollaborateEvent = OnCollaborateChangeEvent

// Discriminated union: data exists exactly when connected, the error
// string exactly when disconnected. No field needs manual null-keeping.
export type CheckState =
  | { phase: 'checking' }
  | { phase: 'connected'; data: ZoomDiagnostics }
  | { phase: 'disconnected'; error: string }

let configurationPromise: Promise<ZoomDiagnostics> | null = null

function configure(capabilities: Apis[]) {
  return zoomSdk.config({
    capabilities,
    popoutSize: { width: 480, height: 720 },
    timeout: 10_000,
    version: zoomSdkVersion as ConfigOptions['version'],
  })
}

// Asks the Zoom client for a signed app-context token and trades it for the
// identity cookie. The page-load header normally does this, but it cannot
// be relied on, so the panel establishes identity itself on every open.
// Best effort: without it the viewer is simply unverified.
export async function establishIdentity(): Promise<'established' | 'unavailable'> {
  try {
    const { context } = await zoomSdk.getAppContext()
    const res = await fetch('/api/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context }),
    })
    return res.ok ? 'established' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

async function runZoomConfiguration(): Promise<ZoomDiagnostics> {
  // getAppContext must also be enabled for the app in the Marketplace. If
  // it is not, fall back to the original capability set rather than losing
  // the whole panel.
  const config = await configure(zoomCapabilities).catch(() =>
    configure(zoomCapabilities.filter((name) => name !== 'getAppContext')),
  )
  const identity = await establishIdentity()

  const supportsMeetingContext = [
    'inMeeting',
    'inCollaborate',
    'inCollaborateSidecar',
  ].includes(config.runningContext)

  if (!supportsMeetingContext) {
    return { config, meeting: null, user: null, identity }
  }

  const [meetingResult, userResult] = await Promise.allSettled([
    zoomSdk.getMeetingUUID(),
    zoomSdk.getUserContext(),
  ])

  return {
    config,
    meeting:
      meetingResult.status === 'fulfilled' ? meetingResult.value : null,
    user: userResult.status === 'fulfilled' ? userResult.value : null,
    identity,
  }
}

export function configureZoomSdk({ force = false } = {}) {
  if (force || !configurationPromise) {
    const attempt: Promise<ZoomDiagnostics> = runZoomConfiguration().catch(
      (error: unknown) => {
        // Only clear the cache if this attempt is still the active one; a
        // slow stale rejection must not wipe out a newer in-flight config.
        if (configurationPromise === attempt) configurationPromise = null
        throw error
      },
    )
    configurationPromise = attempt
  }

  return configurationPromise
}

export async function startCollaborateMode() {
  return zoomSdk.startCollaborate({ shareScreen: false })
}

export function subscribeToZoomEvents({
  onCollaborateChange,
  onRunningContextChange,
}: {
  onCollaborateChange: (event: CollaborateEvent) => void
  onRunningContextChange: () => void
}) {
  zoomSdk.addEventListener('onCollaborateChange', onCollaborateChange)
  zoomSdk.addEventListener('onRunningContextChange', onRunningContextChange)

  return () => {
    zoomSdk.removeEventListener('onCollaborateChange', onCollaborateChange)
    zoomSdk.removeEventListener(
      'onRunningContextChange',
      onRunningContextChange,
    )
  }
}
