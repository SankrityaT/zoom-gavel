import type { ReactNode } from 'react'
import { Fraunces, Schibsted_Grotesk, Spline_Sans_Mono } from 'next/font/google'

// The panel's own typefaces: the same three as the landing page, without
// the extra display axes, so the in-meeting bundle stays small.
const display = Fraunces({
  subsets: ['latin'],
  weight: 'variable',
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

const body = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-body',
  display: 'swap',
})

const numeral = Spline_Sans_Mono({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-numeral',
  display: 'swap',
})

export default function PanelLayout({ children }: { children: ReactNode }) {
  return <div className={`${display.variable} ${body.variable} ${numeral.variable}`}>{children}</div>
}
