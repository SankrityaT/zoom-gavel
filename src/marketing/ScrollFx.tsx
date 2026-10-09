'use client'

import { useEffect, useRef } from 'react'
import Lenis from 'lenis'
import { DUR, EASE_OUT, MOTION_OK, STAGGER, ScrollTrigger, gsap, useGSAP } from './motion'

// Smooth scrolling and the page's scroll reveals. Everything is visible
// without it: hidden starting states are set here, never in CSS.
export default function ScrollFx() {
  const anchor = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ anchors: true })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
    }
  }, [])

  useGSAP(() => {
    const page = anchor.current?.closest('.page')
    if (!page) return
    const mm = gsap.matchMedia()
    mm.add(MOTION_OK, () => {
      // Blocks rise into place; a group staggers its children.
      for (const el of page.querySelectorAll<HTMLElement>('[data-rise]')) {
        const targets = el.dataset.rise === 'group' ? Array.from(el.children) : el
        gsap.from(targets, {
          y: 28,
          autoAlpha: 0,
          duration: DUR.m,
          ease: EASE_OUT,
          stagger: STAGGER,
          scrollTrigger: { trigger: el, start: 'top 86%', once: true },
        })
      }
      // Headings come up line by line from behind a mask.
      for (const el of page.querySelectorAll<HTMLElement>('[data-lines]')) {
        gsap.from(el.querySelectorAll('.line'), {
          yPercent: 115,
          duration: DUR.l,
          ease: EASE_OUT,
          stagger: STAGGER * 1.5,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        })
      }
      // Paper slabs drift past at their own pace.
      for (const el of page.querySelectorAll<HTMLElement>('[data-drift]')) {
        gsap.fromTo(
          el,
          { yPercent: -Number(el.dataset.drift) },
          {
            yPercent: Number(el.dataset.drift),
            ease: 'none',
            scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
          },
        )
      }
      // Price tags swing on their strings and settle.
      for (const el of page.querySelectorAll<HTMLElement>('[data-swing]')) {
        const from = Number(el.dataset.swing)
        gsap.from(el, {
          rotation: from,
          duration: 2.4,
          ease: 'elastic.out(1, 0.28)',
          scrollTrigger: { trigger: el, start: 'top 92%', once: true },
        })
      }
    })
  })

  return <span ref={anchor} hidden />
}
