import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Fraunces, Schibsted_Grotesk, Spline_Sans_Mono } from 'next/font/google'
import '../index.css'

const display = Fraunces({
  subsets: ['latin'],
  weight: 'variable',
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

export const metadata: Metadata = {
  title: 'Zoom Gavel',
  description:
    'Native, real-time competitive bidding inside a live Zoom meeting.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${numeral.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
