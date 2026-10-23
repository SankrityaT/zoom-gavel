import type { ReactNode } from 'react'
import { Fraunces, Schibsted_Grotesk, Spline_Sans_Mono } from 'next/font/google'

// The same three typefaces as the rest of the site.
const display = Fraunces({ subsets: ['latin'], weight: 'variable', variable: '--font-display', display: 'swap' })
const body = Schibsted_Grotesk({ subsets: ['latin'], weight: 'variable', variable: '--font-body', display: 'swap' })
const numeral = Spline_Sans_Mono({ subsets: ['latin'], weight: 'variable', variable: '--font-numeral', display: 'swap' })

export default function WinnerLayout({ children }: { children: ReactNode }) {
  return <div className={`${display.variable} ${body.variable} ${numeral.variable}`}>{children}</div>
}
