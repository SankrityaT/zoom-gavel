import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '../index.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://gavel-app.sankrityat.com'),
  title: {
    default: 'Gavel for Zoom Meetings · The auction never leaves the meeting',
    template: '%s · Gavel',
  },
  description:
    'Native, real-time competitive bidding inside a live Zoom meeting. Real bids, a live clock, and a gavel. No second tab, no screen share pretending to be a sale.',
  openGraph: {
    type: 'website',
    url: 'https://gavel-app.sankrityat.com',
    siteName: 'Gavel for Zoom Meetings',
    title: 'Gavel for Zoom Meetings · The auction never leaves the meeting',
    description:
      'Live bidding inside the Zoom window itself. Built on the Zoom Apps SDK with real-time sync.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gavel for Zoom Meetings · The auction never leaves the meeting',
    description:
      'Live bidding inside the Zoom window itself. Built on the Zoom Apps SDK with real-time sync.',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  )
}
