'use client'

import { useEffect } from 'react'

// The page's one entrance: every `.rise` lifts once as it comes into view.
// What is already on screen when this runs is shown at once, and nothing
// is hidden until it has run, so the page reads without script.
export default function Rise() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.rise'))
    for (const el of els) {
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight && rect.bottom > 0) el.classList.add('in', 'now')
    }
    document.documentElement.classList.add('rise-ready')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('in')
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.12 },
    )
    for (const el of els) if (!el.classList.contains('in')) observer.observe(el)
    return () => {
      observer.disconnect()
      document.documentElement.classList.remove('rise-ready')
    }
  }, [])
  return null
}
