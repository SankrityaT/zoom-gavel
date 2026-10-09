import Hero from '@/marketing/Hero'
import LotStory from '@/marketing/LotStory'
import Paddle from '@/marketing/Paddle'
import ScrollFx from '@/marketing/ScrollFx'
import { BidPath, Closing, Lots, Questions, Statement } from '@/marketing/Sections'
import '@/panel/panel.css'
import '@/marketing/marketing.css'

export default function HomePage() {
  return (
    <main id="top" className="page">
      <div className="page-gridlines" aria-hidden="true" />
      <Hero />
      <Statement />
      <LotStory />
      <Paddle />
      <BidPath />
      <Lots />
      <Questions />
      <Closing />
      <ScrollFx />
    </main>
  )
}
