import { useEffect, useRef, useState } from 'react'
import hero from '../img/hero.svg'
import frieze from '../img/frieze.svg'
import ganesha from '../img/ganesha.svg'
import lotus from '../img/lotus.svg'
import vineL from '../img/vine-l.svg'
import vineR from '../img/vine-r.svg'
import p1 from '../img/dsc02030.svg'
import p2 from '../img/dsc07413.svg'
import p3 from '../img/dsc03377.svg'
import p4 from '../img/dsc03420.svg'
import p5 from '../img/dsc01957.svg'
import p6 from '../img/dsc04860.svg'
import p7 from '../img/dsc04815.svg'
import p8 from '../img/dsc09813.svg'
import p9 from '../img/dsc05575.svg'
import p10 from '../img/dsc05348.svg'

const photos = [
  { src: p1, alt: 'Couple walking hand in hand wearing fresh leaf garlands' },
  { src: p2, alt: 'Amrutha and Nithin on a stone courtyard' },
  { src: p3, alt: 'The couple seated before the lamp' },
  { src: p4, alt: 'Family on stage around the lamp' },
  { src: p5, alt: 'Close portrait with garlands' },
  { src: p6, alt: 'Couple outside a white house' },
  { src: p7, alt: 'Couple in formal wear in a garden' },
  { src: p8, alt: 'Couple laughing together at a celebration' },
  { src: p9, alt: 'Family and friends on the stage' },
  { src: p10, alt: 'Three posing in front of the flower stage' },
]

function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.12 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref} className={`reveal ${shown ? 'in' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

function Hero() {
  return (
    <header className="hero">
      <img className="hero-art" src={hero} alt="Guruvayoor temple with the couple walking hand in hand" />
      <div className="hero-fade" />
      <Reveal className="hero-names">
        <h1 className="ml-names">
          അമൃത <span className="amp">&amp;</span>
          <br />
          നിതിൻ കൃഷ്ണ
        </h1>
        <p className="datebar">25 October 2026 &middot; 1202 Thulam 8</p>
      </Reveal>
    </header>
  )
}

function Intro() {
  return (
    <section className="invite intro">
      <img className="vine vine-l" src={vineL} alt="" />
      <img className="vine vine-r" src={vineR} alt="" />
      <Reveal className="inner">
        <img className="ganesha" src={ganesha} alt="Ganesha emblem" />
        <h2 className="script">Amrutha</h2>
        <p className="with">with</p>
        <h2 className="script">Nithin Krishna</h2>
        <img className="lotus mid" src={lotus} alt="" />
        <p className="hosts">
          <strong>Sunday 25th October 2026 (1202 Thulam 8)</strong>
          <br />
          Sree Krishna Temple, Guruvayoor
        </p>
      </Reveal>
    </section>
  )
}

function Band() {
  return (
    <section className="band" style={{ backgroundImage: `url(${p1})` }} aria-label="Photo of the couple walking together" />
  )
}

function Gallery() {
  const [open, setOpen] = useState(null)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <section className="gallery">
      <Reveal as="h2" className="ml">
        ഓർമ്മകൾ <small>Memories</small>
      </Reveal>
      <div className="grid">
        {photos.map((p) => (
          <Reveal as="figure" key={p.src} onClick={() => setOpen(p)}>
            <img loading="lazy" src={p.src} alt={p.alt} />
          </Reveal>
        ))}
      </div>
      {open && (
        <div className="lb" onClick={() => setOpen(null)}>
          <img src={open.src} alt={open.alt} />
        </div>
      )}
    </section>
  )
}

export default function App() {
  return (
    <>
      <Hero />
      <main>
        <Intro />
        <Band />
        <Gallery />
      </main>
      <footer>
        <img className="frieze" src={frieze} alt="Line drawing of a wedding procession" />
        <p>Amrutha &amp; Nithin Krishna &middot; Guruvayoor &middot; 25 October 2026</p>
      </footer>
    </>
  )
}
