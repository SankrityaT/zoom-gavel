// The cut-paper world from the hero, as pieces the sections can place:
// coloured slabs, the little grey cubes, and blank tags on black string.

export function Slab({ tone, className = '', drift }: { tone: 'blue' | 'coral' | 'mint' | 'pink'; className?: string; drift?: number }) {
  return <i className={`slab slab--${tone} ${className}`} data-drift={drift} aria-hidden="true" />
}

export function PaperTag({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  return (
    <span className={`ptag ${className}`} aria-hidden={children ? undefined : true}>
      <svg className="ptag-string" viewBox="0 0 120 90" fill="none" aria-hidden="true">
        <path
          d="M62 78C40 60 8 66 10 44 12 24 44 30 58 40c14 10 36 8 44-6 6-12-4-22-16-18"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <span className="ptag-body">
        <span className="ptag-hole" />
        {children}
      </span>
    </span>
  )
}
