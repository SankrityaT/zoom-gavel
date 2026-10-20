'use client'

import { useCallback, useEffect, useState } from 'react'

// "Sign in with Zoom" for people bidding from a browser. A guest is whoever
// the browser says it is; signing in makes the person a Zoom-verified bidder,
// the same as in the meeting, so one person is one bidder and only they can
// bid as them. Not shown inside the Zoom client, which already knows who you are.

type Me = { signedIn: boolean; name: string | null; canSignIn: boolean }

export function useBrowserSignIn(enabled: boolean) {
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let active = true
    // The sign-in handshake ends by redirecting back here with a flag.
    const url = new URL(window.location.href)
    if (url.searchParams.get('signin') === 'failed') {
      url.searchParams.delete('signin')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      queueMicrotask(() => active && setFailed(true))
    }
    fetch('/api/me', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<Me>) : null))
      .then((next) => {
        if (active && next) setMe(next)
      })
      .catch(() => {
        // Sign-in is an extra; the panel works without it.
      })
    return () => {
      active = false
    }
  }, [enabled])

  const signOut = useCallback(async () => {
    await fetch('/api/me', { method: 'DELETE', headers: { 'content-type': 'application/json' } }).catch(() => undefined)
    window.location.reload()
  }, [])

  return { me, failed, signOut, dismissFailure: () => setFailed(false) }
}

export default function SignInBar({
  me,
  failed,
  signOut,
}: {
  me: Me | null
  failed: boolean
  signOut: () => void
}) {
  if (!me) return null
  if (me.signedIn) {
    return (
      <div className="gv-signin gv-signin--on">
        <p>
          Signed in with Zoom{me.name ? <> as <b>{me.name}</b></> : null}
        </p>
        <button className="gv-link" type="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    )
  }
  if (!me.canSignIn) return null
  const back = encodeURIComponent(window.location.pathname + window.location.search)
  return (
    <div className="gv-signin">
      <p>
        {failed ? 'Sign in did not finish. Try again.' : 'You are bidding as a guest.'}
        <span>Sign in with Zoom so nobody else can bid as you.</span>
      </p>
      <a className="gv-pill" href={`/api/oauth/zoom/start?return=${back}`}>
        Sign in with Zoom
      </a>
    </div>
  )
}
