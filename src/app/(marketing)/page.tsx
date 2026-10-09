import Details from '@/marketing/Details'
import Hero from '@/marketing/Hero'
import LotStory from '@/marketing/LotStory'
import Nav from '@/marketing/Nav'
import Paddle from '@/marketing/Paddle'
import Rise from '@/marketing/Rise'
import { Ending, Questions } from '@/marketing/Sections'
import '@/panel/panel.css'
import '@/marketing/marketing.css'

export default function HomePage() {
  return (
    <div id="top" className="page">
      <Nav />
      <Hero />
      <main className="wrap">
        <LotStory />
        <Paddle />
        <Details />
        <Questions />
      </main>
      <Ending />
      <Rise />
    </div>
  )
}
