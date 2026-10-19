import Link from 'next/link'
import type { ReactNode } from 'react'
import { APP_NAME, SUPPORT_EMAIL, UPDATED } from './contact'
import './legal.css'

// A plain reading page for the policy, terms, support and guide. No script,
// no tracking, one column.
export default function Doc({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="doc">
      <header className="doc-head">
        <Link href="/" className="doc-brand">
          Zoom Gavel
        </Link>
        <nav aria-label="Pages">
          <Link href="/guide">Guide</Link>
          <Link href="/support">Support</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </header>
      <main className="doc-body">
        <h1>{title}</h1>
        <p className="doc-lead">{lead}</p>
        {children}
        <p className="doc-foot">
          {APP_NAME} · Last updated {UPDATED} · <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </main>
    </div>
  )
}
