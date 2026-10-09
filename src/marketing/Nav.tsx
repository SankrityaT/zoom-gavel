'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import logoMark from './assets/logo.png'

const SECTIONS = [
  { id: 'lot', label: 'How a lot goes' },
  { id: 'paddle', label: 'Try bidding' },
  { id: 'bidders', label: 'For bidders' },
  { id: 'questions', label: 'Questions' },
]

// The black tab that hangs from the top edge. At the top of the page it is
// only the name and the one button; once the page has moved it widens to
// show the sections, the one in view bright.
export default function Nav() {
  const [moved, setMoved] = useState(false)
  const [near, setNear] = useState(false)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState('')

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
    return () => {
      window.removeEventListener('scroll', onScroll)
      observer.disconnect()
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

  const wide = moved || near

  return (
    <nav
      className="nav"
      aria-label="Main"
      data-wide={wide}
      data-open={open}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setNear(true)}
      onPointerLeave={() => setNear(false)}
      onFocus={() => setNear(true)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setNear(false)}
    >
      <div className="nav-bar">
        <a className="nav-brand" href="#top" onClick={() => setOpen(false)}>
          <Image src={logoMark} alt="" width={26} height={26} />
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
