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
import EG from './data/eg.js'
import mx0 from './data/mx0.js'
import mx1 from './data/mx1.js'
import mx2 from './data/mx2.js'
import sd1 from '../img/save-date.svg'

// Photos the user asked to remove (handshake, hug and flower-bowl shots), kept out of the gallery
const REMOVED = new Set(['rg2', 'rg3', 'rg4', 'rg5', 'rg6', 'rg7', 'rg9', 'rg10'])
const rangoliExtra = [...rg0, ...rg1, ...rg2, ...rg3].map((src, i) => ({ id: 'rg' + (i + 1), ev: 'rangoli', src, alt: 'Rangoli night' }))
  .filter((p) => !REMOVED.has(p.id))
const hiMods = import.meta.glob('./data/hi/*.js')
import PH from './photos.json'
const phSet = (id) => (PH[id] ? PH[id].w.map(([w]) => `${import.meta.env.BASE_URL}photos/${id}-${w}.webp ${w}w`).join(', ') : undefined)
const phMax = (id) => { const w = PH[id].w; return `${import.meta.env.BASE_URL}photos/${id}-${w[w.length - 1][0]}.webp` }

function useHi(id, want, ref) {
  const [hi, setHi] = useState(null)
  useEffect(() => {
    const load = hiMods['./data/hi/' + id + '.js']
    if (!id || PH[id] || !load || (hi && hi.id === id)) return
    if (want === true) {
      load().then((m) => setHi({ id, src: m.default }))
      return
    }
    const el = ref && ref.current
    if (!want || !el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        io.disconnect()
        load().then((m) => setHi({ id, src: m.default }))
      }
    }, { rootMargin: '700px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [id, want, hi])
  return hi && hi.id === id ? hi.src : null
}

function useWide() {
  const [w, setW] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1000px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1000px)')
    const f = () => setW(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return w
}
const sdExtra = [...sdd0, ...sdd1, ...sdd2, ...sdd3, ...sdd4, ...sdd5]
const MX = { ...mx0, ...mx1, ...mx2 }
const moreExtra = [["i185443_597", "rangoli", "Rangoli night"], ["i185444_182", "rangoli", "Rangoli night"], ["i185506_641", "rangoli", "Rangoli night"], ["i185507_301", "rangoli", "Rangoli night"], ["i185507_208", "rangoli", "Rangoli night"], ["i185522_667", "rangoli", "Rangoli night"], ["i185526_347", "rangoli", "Rangoli night"], ["dsc05549", "reception", "Reception"], ["dsc05550", "reception", "Reception"], ["dsc03399", "wedding", "Wedding"], ["dsc01978", "wedding", "Wedding"], ["dsc02339", "wedding", "Wedding"], ["dsc03354", "wedding", "Wedding"]].map(([id, ev, alt]) => ({ id, ev, src: MX[id], alt }))
const photos = [
  { id: 'dsc02030', ev: 'wedding', src: p1, alt: 'Couple walking hand in hand wearing fresh leaf garlands' },
  { id: 'dsc07413', ev: 'first', src: p2, alt: 'Amrutha and Nithin on a stone courtyard' },
  { id: 'dsc03377', ev: 'wedding', src: p3, alt: 'The couple seated before the lamp' },
  { id: 'dsc03420', ev: 'wedding', src: p4, alt: 'Family on stage around the lamp' },
  { id: 'dsc01957', ev: 'wedding', src: p5, alt: 'Close portrait with garlands' },
  { id: 'dsc04860', ev: 'reception', src: p6, alt: 'Couple outside a white house' },
  { id: 'dsc04815', ev: 'reception', src: p7, alt: 'Couple in formal wear in a garden' },
  { id: 'r2', ev: 'rangoli', src: r2, alt: 'Family together before the marigold backdrop' },
  { id: 'dsc09813', ev: 'rangoli', src: p8, alt: 'Couple laughing together at a celebration' },
  { id: 'dsc05575', ev: 'reception', src: p9, alt: 'Family and friends on the stage' },
  ...rangoliExtra,
  ...moreExtra,
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
      <div className="hero-bg" style={{ backgroundImage: `url(${hero})` }} />
      <div className="hero-frame" style={{ transform: `translateY(${y * 0.25}px) scale(${1 + Math.min(y, 600) * 0.0002})` }}>
        <img className="hero-art" src={hero} alt="Guruvayoor temple with the couple walking hand in hand" />
      </div>
      <Sparkles />
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
  { ev: 'reception', id: 'v1', file: 'vid/v1.mp4', poster: import.meta.env.BASE_URL + 'vid/v1-poster.jpg', label: 'Dancing together' },
  { ev: 'wedding', id: 'v2', file: 'vid/v2.mp4', poster: import.meta.env.BASE_URL + 'vid/v2-poster.jpg', label: 'The celebration' },
  { ev: 'rangoli', id: 'v3', file: 'vid/v3.mp4', poster: import.meta.env.BASE_URL + 'vid/v3-poster.jpg', label: 'Joy on the lawn' },
  { ev: 'engagement', id: 'v5', wide: true, file: 'vid/v5.mp4', poster: import.meta.env.BASE_URL + 'vid/v5-poster.jpg', label: 'Engagement' },
  { ev: 'wedding', id: 'v4', wide: true, file: 'vid/v4.mp4', poster: import.meta.env.BASE_URL + 'vid/v4-poster.jpg', label: 'Family moments' },
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
          started = true;
          (clip.file ? Promise.resolve(import.meta.env.BASE_URL + clip.file) : loadClip(clip.id, clip.parts)).then((u) => {
            url = u
            setSrc(u)
          })
        }
        if (v && !e.isIntersecting) v.pause()
      },
      { threshold: 0.35, rootMargin: '200px 0px' }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      if (url) URL.revokeObjectURL(url)
    }
  }, [clip])
  const start = () => {
    const v = vid.current
    if (v && v.paused) {
      v.muted = false
      v.volume = 1
      v.play().catch(() => {})
    }
  }
  return (
    <Reveal className={clip.wide ? 'vcell wide' : 'vcell'}>
      <Tilt className={`vtile ${playing ? 'is-playing' : ''}`}>
        <div ref={wrap} className="vbox">
          <img className="vposter" src={clip.poster} alt="" />
          {src && (
            <video
              ref={vid}
              src={src}
              poster={clip.poster}
              controls
              loop
              playsInline
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              aria-label={clip.label}
            />
          )}
          {!playing && (
            <button className="vplay" onClick={start} aria-label={'Play ' + clip.label + ' with sound'}>
              <span className="tri" />
            </button>
          )}
          <span className="vlabel">{clip.label}</span>
          {!playing && <span className="vbadge" aria-hidden="true">tap to play with sound</span>}
        </div>
      </Tilt>
    </Reveal>
  )
}

function Videos({ list }) {
  return (
    <section className="videos" id="videos">
      <h3 className="vh">Moving memories</h3>
      <div className="vgrid">
        {list.map((c) => (
          <VideoTile key={c.id} clip={c} />
        ))}
      </div>
    </section>
  )
}


function Ornament() {
  return (
    <svg className="orn" viewBox="0 0 220 24" aria-hidden="true">
      <path d="M0 12H84M136 12H220" stroke="currentColor" strokeWidth="1.5" />
      <path d="M110 2c5 5 5 15 0 20c-5-5-5-15 0-20z M110 12c6-8 16-8 22-4c-6 8-16 8-22 4z M110 12c-6-8-16-8-22-4c6 8 16 8 22 4z" fill="currentColor" />
      <circle cx="76" cy="12" r="2.5" fill="currentColor" />
      <circle cx="144" cy="12" r="2.5" fill="currentColor" />
    </svg>
  )
}

function SectionHead({ ml, en, n, count, small, date }) {
  return (
    <Reveal as="div" className="shead">
      <span className="wm" aria-hidden="true">{n}</span>
      <h3 className={small ? 'sdh' : 'evh'}>
        <span className="tml">{ml}</span>
        <span className="ten">{en}</span>
      </h3>
      <Ornament />
      {date && <p className="sdate">{date}</p>}
      <p className="cnt">{count}</p>
    </Reveal>
  )
}

function Sparkles() {
  const dots = useMemo(
    () => Array.from({ length: 16 }, (_, i) => ({ l: (i * 37 + 7) % 100, t: (i * 53 + 11) % 70, s: 4 + ((i * 3) % 7), d: (i * 0.45) % 5 })),
    []
  )
  return (
    <div className="sparkles" aria-hidden="true">
      {dots.map((d, i) => (
        <i key={i} style={{ left: d.l + '%', top: d.t + '%', width: d.s, height: d.s, animationDelay: d.d + 's' }} />
      ))}
    </div>
  )
}

function Count({ to }) {
  const ref = useRef(null)
  const [v, setV] = useState(0)
  useEffect(() => {
    const el = ref.current
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / 1400)
        setV(Math.round(to * (1 - Math.pow(1 - k, 3))))
        if (k < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [to])
  return <b ref={ref}>{v}</b>
}

function Stats({ items }) {
  return (
    <Reveal className="stats">
      {items.map((it) => (
        <div key={it.label} className="stat">
          <Count to={it.n} />
          <span>{it.label}</span>
        </div>
      ))}
    </Reveal>
  )
}

const NAV = [
  { id: 'engagement', label: 'Engagement' },
  { id: 'savedate', label: 'Save the date' },
  { id: 'rangoli', label: 'Rangoli night' },
  { id: 'wedding', label: 'Wedding' },
  { id: 'reception', label: 'Reception' },
  { id: 'videos', label: 'Videos' },
]

function Nav() {
  const y = useScrollY()
  const [on, setOn] = useState('')
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setOn(e.target.id)),
      { rootMargin: '-35% 0px -55% 0px' }
    )
    NAV.forEach((n) => {
      const el = document.getElementById(n.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])
  return (
    <nav className={`sitenav ${y > 500 ? 'show' : ''}`} aria-label="Sections">
      {NAV.map((n) => (
        <a key={n.id} href={'#' + n.id} className={on === n.id ? 'on' : ''}>{n.label}</a>
      ))}
    </nav>
  )
}

function Cell({ p, i, onOpen }) {
  const [ar, setAr] = useState(PH[p.id] ? PH[p.id].ar : 0.75)
  const imgRef = useRef(null)
  const wide = useWide()
  const hi = useHi(p.id, wide, imgRef)
  return (
    <Reveal
      className="cell"
      style={{ '--k': i % 7, '--dir': i % 2 ? 1 : -1, transitionDelay: (i % 3) * 120 + 'ms', '--ar': ar, flexGrow: ar * 100 }}
    >
      <Tilt onClick={onOpen}>
        <img
          ref={imgRef}
          loading="lazy"
          src={PH[p.id] ? phMax(p.id) : hi || p.src}
          srcSet={phSet(p.id)}
          style={{ background: `center / cover url(${p.src})`, aspectRatio: PH[p.id] ? PH[p.id].ar : undefined }}
          sizes="(min-width: 1000px) 50vw, 100vw"
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
  const hiLb = useHi(open === null ? null : photos[open].id, true)
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
          <img key={open} src={PH[photos[open].id] ? phMax(photos[open].id) : hiLb || photos[open].src} srcSet={phSet(photos[open].id)} sizes="100vw" alt={photos[open].alt} onClick={(e) => e.stopPropagation()} />
          <button className="nav next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1) }}>&#8250;</button>
          <button className="close" aria-label="Close" onClick={(e) => { e.stopPropagation(); close() }}>&times;</button>
          <div className="thumbs" onClick={(e) => e.stopPropagation()}>
            {photos.map((p, i) => (
              <img key={i} src={p.src} alt="" className={i === open ? 'on' : ''} onClick={() => setOpen(i)} />
            ))}
          </div>
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

const STOPS = [
  { id: 'engagement', en: 'Engagement', ml: 'വിവാഹനിശ്ചയം', date: '20 Nov 2026' },
  { id: 'savedate', en: 'Save the date', ml: 'സേവ് ദി ഡേറ്റ്' },
  { id: 'rangoli', en: 'Rangoli night', ml: 'രംഗോലി നൈറ്റ്' },
  { id: 'wedding', en: 'Wedding', ml: 'വിവാഹം', date: '25 Oct 2026' },
  { id: 'reception', en: 'Reception', ml: 'റിസപ്ഷൻ' },
  { id: 'videos', en: 'Moving memories', ml: 'വീഡിയോകൾ' },
]

function Roadmap({ counts }) {
  return (
    <section className="road" aria-label="Roadmap of the celebrations">
      <Reveal as="h3" className="road-h">The journey</Reveal>
      <Reveal as="ol" className="road-path">
        {STOPS.map((st, i) => (
          <li key={st.id} style={{ '--i': i }}>
            <a href={'#' + st.id}>
              <span className="node"><b>{i + 1}</b></span>
              <span className="rt">
                <span className="rml">{st.ml}</span>
                <span className="ren">{st.en}</span>
                {st.date && <span className="rdate">{st.date}</span>}
                <span className="rcount">{counts[st.id]} {st.id === 'videos' ? 'videos' : 'photos'}</span>
              </span>
            </a>
          </li>
        ))}
      </Reveal>
    </section>
  )
}

function Events() {
  const eng = Object.keys(EG).map((id) => ({ id, ev: 'engagement', src: EG[id], alt: 'Engagement' }))
  const sd = [sd1, p2, ...sdExtra].map((src, i) => ({ id: i >= 2 ? 'an' + (i - 1) : i === 1 ? 'dsc07413' : null, src, alt: 'Amrutha and Nithin, save the date' }))
  return (
    <section className="events">
      <Reveal as="h2" className="ml">
        ഓർമ്മകൾ <small>Memories</small>
      </Reveal>
      <Stats
        items={[
          { n: eng.length + sd.length + photos.length, label: 'Photos' },
          { n: clips.length, label: 'Videos' },
          { n: 5, label: 'Celebrations' },
        ]}
      />
      <Roadmap counts={{ engagement: eng.length, savedate: sd.length, rangoli: photos.filter((p) => p.ev === 'rangoli').length, wedding: photos.filter((p) => p.ev === 'wedding').length, reception: photos.filter((p) => p.ev === 'reception').length, videos: clips.length }} />
      <div className="evsec" id="engagement">
        <SectionHead ml="വിവാഹനിശ്ചയം" en="Engagement" n="01" count={eng.length + ' photos'} date="20 November 2026" />
        <Gallery photos={eng} />
      </div>
      <div className="savedate evsec" id="savedate">
        <SectionHead ml="സേവ് ദി ഡേറ്റ്" en="Save the date" n="02" count={sd.length + ' photos'} small />
        <Gallery photos={sd} />
      </div>
      {EVENTS.map((e, k) => {
        const ps = photos.filter((p) => p.ev === e.id)
        return (
          <div key={e.id} className="evsec" id={e.id}>
            <SectionHead ml={e.ml} en={e.en} n={'0' + (k + 3)} count={ps.length + ' photos'} date={e.id === 'wedding' ? '25 October 2026' : undefined} />
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
      <Nav />
      <Hero />
      <main>
        <Intro />
        <Band />
        <Events />
      </main>
      <footer>
        <div className="frieze-wrap">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <img key={i} className={`frieze ${i % 2 ? 'flip' : ''}`} src={frieze} alt={i === 0 ? 'Line drawing of a wedding procession' : ''} aria-hidden={i === 0 ? undefined : 'true'} />
          ))}
        </div>
        <p>Amrutha &amp; Nithin Krishna &middot; Guruvayoor &middot; 25 October 2026</p>
      </footer>
    </>
  )
}
