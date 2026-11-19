import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import hero from '../img/hero.svg'
import frieze from '../img/frieze.svg'
import ganesha from '../img/ganesha.svg'
import lotus from '../img/lotus.svg'
import vineL from '../img/vine-l.svg'
import vineR from '../img/vine-r.svg'
import v1p from '../img/v1-poster.svg'
import v2p from '../img/v2-poster.svg'
import v3p from '../img/v3-poster.svg'
import p1 from '../img/dsc02030.svg'
import p2 from '../img/dsc07413.svg'
import p3 from '../img/dsc03377.svg'
import p4 from '../img/dsc03420.svg'
import p5 from '../img/dsc01957.svg'
import p6 from '../img/dsc04860.svg'
import p7 from '../img/dsc04815.svg'
import p8 from '../img/dsc09813.svg'
import p9 from '../img/dsc05575.svg'
import r2 from '../img/rangoli2.svg'
import rg0 from './data/rg0.js'
import rg1 from './data/rg1.js'
import rg2 from './data/rg2.js'
import rg3 from './data/rg3.js'
import sdd0 from './data/sd0.js'
import sdd1 from './data/sd1.js'
import sdd2 from './data/sd2.js'
import sdd3 from './data/sd3.js'
import sdd4 from './data/sd4.js'
import sdd5 from './data/sd5.js'
import sd1 from '../img/save-date.svg'

const rangoliExtra = [...rg0, ...rg1, ...rg2, ...rg3].map((src) => ({ ev: 'rangoli', src, alt: 'Rangoli night' }))
const sdExtra = [...sdd0, ...sdd1, ...sdd2, ...sdd3, ...sdd4, ...sdd5]
const photos = [
  { ev: 'wedding', src: p1, alt: 'Couple walking hand in hand wearing fresh leaf garlands' },
  { ev: 'first', src: p2, alt: 'Amrutha and Nithin on a stone courtyard' },
  { ev: 'wedding', src: p3, alt: 'The couple seated before the lamp' },
  { ev: 'wedding', src: p4, alt: 'Family on stage around the lamp' },
  { ev: 'wedding', src: p5, alt: 'Close portrait with garlands' },
  { ev: 'reception', src: p6, alt: 'Couple outside a white house' },
  { ev: 'reception', src: p7, alt: 'Couple in formal wear in a garden' },
  { ev: 'rangoli', src: r2, alt: 'Family together before the marigold backdrop' },
  { ev: 'rangoli', src: p8, alt: 'Couple laughing together at a celebration' },
  { ev: 'reception', src: p9, alt: 'Family and friends on the stage' },
  ...rangoliExtra,
]


function useScrollY() {
  const [y, setY] = useState(0)
  useEffect(() => {
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setY(window.scrollY))
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => {
      window.removeEventListener('scroll', on)
      cancelAnimationFrame(raf)
    }
  }, [])
  return y
}

function Progress() {
  const y = useScrollY()
  const max = typeof document === 'undefined' ? 1 : Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
  return <div className="progress" style={{ transform: `scaleX(${Math.min(1, y / max)})` }} />
}

function Petals() {
  const petals = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        left: Math.round((i * 47) % 100),
        size: 10 + ((i * 7) % 14),
        dur: 11 + ((i * 5) % 9),
        delay: -((i * 3) % 14),
        drift: ((i % 2 ? 1 : -1) * (30 + ((i * 11) % 60))),
      })),
    []
  )
  return (
    <div className="petals" aria-hidden="true">
      {petals.map((p) => (
        <span
          key={p.id}
          style={{
            left: p.left + '%',
            width: p.size,
            height: p.size * 1.3,
            animationDuration: p.dur + 's',
            animationDelay: p.delay + 's',
            '--drift': p.drift + 'px',
          }}
        />
      ))}
    </div>
  )
}

function Letters({ text }) {
  // Split by grapheme cluster so Malayalam conjuncts stay intact; fall back to whole words.
  const parts =
    typeof Intl !== 'undefined' && Intl.Segmenter
      ? Array.from(new Intl.Segmenter('ml', { granularity: 'grapheme' }).segment(text), (x) => x.segment)
      : text.split(/(\s+)/)
  return (
    <span className="letters" aria-label={text}>
      {parts.map((ch, i) => (
        <span key={i} aria-hidden="true" style={{ '--i': i }}>
          {ch === ' ' ? '\u00a0' : ch}
        </span>
      ))}
    </span>
  )
}

function Tilt({ children, className = '', ...rest }) {
  const ref = useRef(null)
  const move = (e) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--rx', (-y * 10).toFixed(2) + 'deg')
    el.style.setProperty('--ry', (x * 12).toFixed(2) + 'deg')
    el.style.setProperty('--gx', (x + 0.5) * 100 + '%')
    el.style.setProperty('--gy', (y + 0.5) * 100 + '%')
  }
  const leave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }
  return (
    <figure ref={ref} className={`tilt ${className}`} onMouseMove={move} onMouseLeave={leave} {...rest}>
      {children}
      <span className="shine" />
    </figure>
  )
}

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
  const y = useScrollY()
  return (
    <header className="hero">
      <div className="hero-frame" style={{ transform: `translateY(${y * 0.25}px) scale(${1 + Math.min(y, 600) * 0.0002})` }}>
        <img className="hero-art" src={hero} alt="Guruvayoor temple with the couple walking hand in hand" />
      </div>
      <div className="hero-fade" />
      <div className="hero-names" style={{ transform: `translateY(${y * -0.08}px)` }}>
        <h1 className="ml-names">
          <Letters text="അമൃത" /> <span className="amp">&amp;</span>
          <br />
          <Letters text="നിതിൻ കൃഷ്ണ" />
        </h1>
        <p className="datebar">25 October 2026 &middot; 1202 Thulam 8</p>
        <span className="scroll-hint" aria-hidden="true">scroll</span>
      </div>
    </header>
  )
}

function Intro() {
  return (
    <section className="invite intro">
      <img className="vine vine-l" src={vineL} alt="" />
      <img className="vine vine-r" src={vineR} alt="" />
      <Reveal className="inner">
        <img className="ganesha float" src={ganesha} alt="Ganesha emblem" />
        <h2 className="script">Amrutha</h2>
        <p className="with">with</p>
        <h2 className="script">Nithin Krishna</h2>
        <img className="lotus mid glow" src={lotus} alt="" />
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
  const ref = useRef(null)
  const y = useScrollY()
  const [off, setOff] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setOff((r.top + r.height / 2 - window.innerHeight / 2) * -0.25)
  }, [y])
  return (
    <section ref={ref} className="band" aria-label="Photo of the couple walking together">
      <img src={p1} alt="" style={{ transform: `translateY(${off * 0.3}px)` }} />
      <Reveal as="p" className="band-quote">ഓർമ്മകൾ</Reveal>
    </section>
  )
}

const clips = [
  { ev: 'reception', id: 'v1', parts: 3, poster: v1p, label: 'Dancing together' },
  { ev: 'wedding', id: 'v2', parts: 2, poster: v2p, label: 'The celebration' },
  { ev: 'rangoli', id: 'v3', parts: 3, poster: v3p, label: 'Joy on the lawn' },
]

// Clips are stored as base64 text chunks (the repo only accepts text files), rebuilt into a Blob in the browser.
async function loadClip(id, parts) {
  const base = import.meta.env.BASE_URL
  const texts = await Promise.all(
    Array.from({ length: parts }, (_, i) => fetch(`${base}vid/${id}-${i}.txt`).then((r) => r.text()))
  )
  const bin = atob(texts.join(''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
}

function VideoTile({ clip }) {
  const wrap = useRef(null)
  const vid = useRef(null)
  const [src, setSrc] = useState(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const el = wrap.current
    let started = false
    let url = null
    const io = new IntersectionObserver(
      ([e]) => {
        const v = vid.current
        if (e.isIntersecting && !started) {
          started = true
          loadClip(clip.id, clip.parts).then((u) => {
            url = u
            setSrc(u)
          })
        }
        if (v) {
          if (e.isIntersecting) v.play().catch(() => {})
          else v.pause()
        }
      },
      { threshold: 0.35, rootMargin: '200px 0px' }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      if (url) URL.revokeObjectURL(url)
    }
  }, [clip])
  const toggle = () => {
    const v = vid.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }
  return (
    <Reveal className="vcell">
      <Tilt className={`vtile ${playing ? 'is-playing' : ''}`} onClick={toggle}>
        <div ref={wrap} className="vbox">
          <img className="vposter" src={clip.poster} alt="" />
          {src && (
            <video
              ref={vid}
              src={src}
              muted
              loop
              playsInline
              autoPlay
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              aria-label={clip.label}
            />
          )}
          <span className="vlabel">{clip.label}</span>
          <span className="vbadge" aria-hidden="true">{playing ? 'tap to pause' : 'tap to play'}</span>
        </div>
      </Tilt>
    </Reveal>
  )
}

function Videos({ list }) {
  return (
    <section className="videos">
      <h3 className="vh">Moving memories</h3>
      <div className="vgrid">
        {list.map((c) => (
          <VideoTile key={c.id} clip={c} />
        ))}
      </div>
    </section>
  )
}

function Cell({ p, i, onOpen }) {
  const [ar, setAr] = useState(0.75)
  return (
    <Reveal
      className="cell"
      style={{ transitionDelay: (i % 3) * 120 + 'ms', flexGrow: ar * 100, flexBasis: ar * 230 + 'px', maxWidth: ar * 560 + 'px' }}
    >
      <Tilt onClick={onOpen}>
        <img
          loading="lazy"
          src={p.src}
          alt={p.alt}
          onLoad={(e) => e.currentTarget.naturalHeight && setAr(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        />
      </Tilt>
    </Reveal>
  )
}

function Gallery({ photos }) {
  const [open, setOpen] = useState(null)
  const close = useCallback(() => setOpen(null), [])
  const step = useCallback((d) => setOpen((i) => (i === null ? i : (i + d + photos.length) % photos.length)), [])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, step])
  useEffect(() => {
    document.body.style.overflow = open === null ? '' : 'hidden'
  }, [open])
  const touch = useRef(0)
  return (
    <section className="gallery">
      <div className="grid">
        {photos.map((p, i) => (
          <Cell key={p.src} p={p} i={i} onOpen={() => setOpen(i)} />
        ))}
      </div>
      {open !== null && (
        <div
          className="lb"
          onClick={close}
          onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - touch.current
            if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1)
          }}
        >
          <button className="nav prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1) }}>&#8249;</button>
          <img key={open} src={photos[open].src} alt={photos[open].alt} onClick={(e) => e.stopPropagation()} />
          <button className="nav next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1) }}>&#8250;</button>
          <span className="count">{open + 1} / {photos.length}</span>
        </div>
      )}
    </section>
  )
}

const EVENTS = [
  { id: 'rangoli', ml: 'രംഗോലി നൈറ്റ്', en: 'Rangoli Night' },
  { id: 'wedding', ml: 'വിവാഹം', en: 'Wedding' },
  { id: 'reception', ml: 'റിസപ്ഷൻ', en: 'Reception' },
]

function Events() {
  return (
    <section className="events">
      <Reveal as="h2" className="ml">
        ഓർമ്മകൾ <small>Memories</small>
      </Reveal>
      <div className="savedate">
        <Reveal as="h3" className="sdh">Save the date</Reveal>
        <Gallery photos={[sd1, p2, ...sdExtra].map((src) => ({ src, alt: 'Amrutha and Nithin, save the date' }))} />
      </div>
      {EVENTS.map((e) => {
        const ps = photos.filter((p) => p.ev === e.id)
        return (
          <div key={e.id} className="evsec" id={e.id}>
            <Reveal as="h3" className="evh">
              <span className="tml">{e.ml}</span>
              <span className="ten">{e.en}</span>
            </Reveal>
            <Gallery photos={ps} />
          </div>
        )
      })}
      <Videos list={clips} />
    </section>
  )
}

export default function App() {
  return (
    <>
      <Progress />
      <Petals />
      <Hero />
      <main>
        <Intro />
        <Band />
        <Events />
      </main>
      <footer>
        <div className="frieze-wrap">
          <img className="frieze" src={frieze} alt="Line drawing of a wedding procession" />
          <img className="frieze" src={frieze} alt="" aria-hidden="true" />
        </div>
        <p>Amrutha &amp; Nithin Krishna &middot; Guruvayoor &middot; 25 October 2026</p>
      </footer>
    </>
  )
}
