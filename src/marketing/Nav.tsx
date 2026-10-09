'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { formatUsd } from '@/lib/gavel/demo'
import logoMark from './assets/logo.png'
import { useLive } from './live'

const SECTIONS = [
  { id: 'lot', label: 'How a lot goes' },
  { id: 'paddle', label: 'Try bidding' },
  { id: 'bidders', label: 'For bidders' },
  { id: 'questions', label: 'Questions' },
]

// The lot on the block, carried down the page: its price and its clock, as
// they run in the hero's meeting. It joins the bar once that meeting has
// scrolled away.
function LiveLot({ shown }: { shown: boolean }) {
  const live = useLive()
  const [now, setNow] = useState(0)
  const open = live?.open ?? false

  useEffect(() => {
    if (!open) return
    const tick = () => setNow(Date.now())
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [open])

  if (!live) return null
  const left = Math.max(0, Math.ceil((live.endsAt - now) / 1000))
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return (
    <a
      className="nav-live"
      href="#demo"
      data-shown={shown}
      data-low={live.open && left <= 10}
      tabIndex={shown ? undefined : -1}
      aria-hidden={shown ? undefined : true}
      aria-label={`The demo lot, ${live.itemName}, at ${formatUsd(live.price)}. Back to the meeting.`}
    >
      <i aria-hidden="true" data-open={live.open} />
      <span className="nav-live-name">{live.itemName}</span>
      <b>{formatUsd(live.price)}</b>
      <span className="nav-live-clock">{live.open ? (now === 0 ? '' : clock) : live.sold ? 'Sold' : 'Closed'}</span>
    </a>
  )
}

// A paper bar floating under the top edge: the name, the sections, the lot
// on the block and one button.
export default function Nav() {
  const [moved, setMoved] = useState(false)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState('')
  const [pastDemo, setPastDemo] = useState(false)

  useEffect(() => {
    const onScroll = () => setMoved(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    // The section crossing a line a third of the way down is the one in view.
    const seen = new Map<string, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.isIntersecting)
        setAt(SECTIONS.find((section) => seen.get(section.id))?.id ?? '')
      },
      { rootMargin: '-34% 0px -65% 0px' },
    )
    for (const section of SECTIONS) {
      const el = document.getElementById(section.id)
      if (el) observer.observe(el)
    }
    // The meeting in the hero has gone by.
    const demo = document.getElementById('demo')
    const demoObserver = new IntersectionObserver(([entry]) => setPastDemo(!entry.isIntersecting), {
      rootMargin: '-80px 0px 0px 0px',
    })
    if (demo) demoObserver.observe(demo)
    return () => {
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
      demoObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.style.overflow = ''
    }
  }, [open])

  return (
    <nav
      className="nav"
      aria-label="Main"
      data-moved={moved}
      data-open={open}
    >
      <div className="nav-bar">
        <a className="nav-brand" href="#top" onClick={() => setOpen(false)}>
          <Image src={logoMark} alt="" width={30} height={30} />
          Zoom Gavel
        </a>
        <div className="nav-links">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} aria-current={at === section.id ? 'true' : undefined}>
              {section.label}
            </a>
          ))}
          <a href="https://github.com/SankrityaT/zoom-gavel" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <LiveLot shown={pastDemo} />
        <a className="nav-cta" href="/zoom-test">
          Open the panel
        </a>
        <button
          className="nav-menu"
          type="button"
          aria-expanded={open}
          aria-controls="nav-sheet"
          aria-label={open ? 'Close the menu' : 'Open the menu'}
          onClick={() => setOpen(!open)}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div id="nav-sheet" className="nav-sheet">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} onClick={() => setOpen(false)}>
              {section.label}
            </a>
          ))}
          <a href="https://github.com/SankrityaT/zoom-gavel" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="nav-sheet-cta" href="/zoom-test">
            Open the panel
          </a>
        </div>
      )}
    </nav>
  )
}
