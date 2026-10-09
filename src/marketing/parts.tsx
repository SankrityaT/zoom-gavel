import Image from 'next/image'
import type { ReactNode } from 'react'
import heroLot from './assets/hero-lot.png'

/** The page's one eyebrow: a soft pill, a coral dot, the section's name in the nav's words. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow">
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

/** A chapter's head: its eyebrow, the line, and an optional lede. */
export function ChapterHead({ label, title, lede, id }: { label: string; title: ReactNode; lede?: ReactNode; id?: string }) {
  return (
    <div className="chapter-head rise">
      <Eyebrow>{label}</Eyebrow>
      <h2 id={id}>{title}</h2>
      {lede ? <p>{lede}</p> : null}
    </div>
  )
}

/** A frame with the lot's own studio photograph behind whatever it shows. `at` picks the part of the photo. */
export function Frame({ at = '8% 80%', zoom = 1.7, className = '', children }: { at?: string; zoom?: number; className?: string; children: ReactNode }) {
  return (
    <div className={`frame ${className}`}>
      <Image
        src={heroLot}
        alt=""
        fill
        sizes="(max-width: 760px) 100vw, 760px"
        className="frame-photo"
        style={{ objectPosition: at, scale: zoom, transformOrigin: at }}
      />
      {children}
    </div>
  )
}

/** A tile: a caption over a piece of the product. */
export function Tile({ title, small, children }: { title: string; small: string; children: ReactNode }) {
  return (
    <figure className="tile">
      <figcaption>
        <b>{title}</b>
        <small>{small}</small>
      </figcaption>
      <div className="tile-show">{children}</div>
    </figure>
  )
}
