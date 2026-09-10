import Hero from '@/marketing/Hero'
import '@/marketing/marketing.css'

export default function HomePage() {
  return (
    <main className="page">
      <div className="page-gridlines" aria-hidden="true" />
      <Hero />
    </main>
  )
}
