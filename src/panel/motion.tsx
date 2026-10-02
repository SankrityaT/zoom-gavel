'use client'

import { useLayoutEffect, useRef, type RefObject } from 'react'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

// A number that rolls like an odometer: every digit is a strip of 0 to 9
// and slides to its new value. Columns are keyed from the right, so going
// from $1,125 to $1,150 turns only the columns that changed, and the
// rightmost turns first.
export function RollingNumber({ text }: { text: string }) {
  const chars = text.split('')
  return (
    <span className="gv-roll" role="text" aria-label={text}>
      {chars.map((ch, index) => {
        const fromRight = chars.length - index
        if (!/\d/.test(ch)) {
          return (
            <span key={`s${fromRight}`} className="gv-roll-sep" aria-hidden="true">
              {ch}
            </span>
          )
        }
        return (
          <span key={`d${fromRight}`} className="gv-roll-col" aria-hidden="true">
            <span
              className="gv-roll-strip"
              style={{
                transform: `translateY(-${Number(ch) * 10}%)`,
                transitionDelay: `${Math.min(fromRight - 1, 5) * 45}ms`,
              }}
            >
              {DIGITS.map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}

// Rows glide to their new place when the order changes (FLIP): measure where
// each keyed child sits after the update, and animate it there from where it
// sat before. `signature` is the order as a string; children carry data-key.
export function useFlip(listRef: RefObject<HTMLElement | null>, signature: string) {
  const positions = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) {
      positions.current = new Map()
      return
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const before = positions.current
    const after = new Map<string, number>()
    for (const el of Array.from(list.children) as HTMLElement[]) {
      const key = el.dataset.key
      if (!key) continue
      // offsetTop is the laid-out position, untouched by a running transform.
      const top = el.offsetTop
      after.set(key, top)
      if (still || typeof el.animate !== 'function') continue
      const was = before.get(key)
      if (was === undefined) {
        // A new bidder joins the board (but not on the very first paint).
        if (before.size > 0) {
          el.animate(
            [
              { opacity: 0, transform: 'translateY(12px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 360, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          )
        }
      } else if (was !== top) {
        const rising = was > top
        // Whoever is climbing passes over the rows they overtake.
        if (rising) el.style.zIndex = '2'
        const move = el.animate(
          [
            { transform: `translateY(${was - top}px) scale(${rising ? 1.03 : 1})` },
            { transform: 'translateY(0) scale(1)' },
          ],
          { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
        if (rising) {
          const settle = () => {
            el.style.zIndex = ''
          }
          move.onfinish = settle
          move.oncancel = settle
        }
      }
    }
    positions.current = after
  }, [listRef, signature])
}
