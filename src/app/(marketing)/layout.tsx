import type { ReactNode } from 'react'
import { Fraunces, Schibsted_Grotesk, Spline_Sans_Mono } from 'next/font/google'

// Marketing typefaces live in this route group so the in-meeting Zoom
// panel (/zoom-test) never pays for ~270KB of fonts it does not use.
const display = Fraunces({
  subsets: ['latin'],
  weight: 'variable',
  // The panel's Sold stamp is set in the italic.
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
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

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${display.variable} ${body.variable} ${numeral.variable}`}>
      {children}
    </div>
  )
}
