import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const B = import.meta.env.BASE_URL
const EVL = { engagement: 'Engagement', first: 'Save the date', savedate: 'Save the date', rangoli: 'Rangoli night', wedding: 'Wedding', reception: 'Reception' }
const MAT = 0.586 // width/height of the photo area on a page

function useNarrow() {
  const q = '(max-width: 760px)'
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = () => setN(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return n
}

// One fixed file per photo on phones (about 800 to 1200 px wide), srcset on desktop.
function tierUrl(p) {
  const need = Math.min(1100, window.innerWidth * (window.devicePixelRatio || 1) * 0.8)
  const t = p.w.find(([x]) => x >= need) || p.w[p.w.length - 1]
  return `${B}photos/${p.id}-${t[0]}.webp`
}
const urlOf = (p, narrow) => (p.t === 'inv' ? p.src : p.t === 'photo' ? (narrow ? tierUrl(p) : null) : null)

function Photo({ p, narrow, near }) {
  const [ok, setOk] = useState(false)
  const box = p.ar < MAT ? { height: '100%' } : { width: '100%' }
  const w = p.w
  const src = narrow ? tierUrl(p) : `${B}photos/${p.id}-${w[Math.min(1, w.length - 1)][0]}.webp`
  return (
    <div className="fb-ph" style={{ ...box, aspectRatio: String(p.ar) }}>
      {near && (
        <img
          className={ok ? 'ok' : ''}
          src={src}
          srcSet={narrow ? undefined : w.map(([x]) => `${B}photos/${p.id}-${x}.webp ${x}w`).join(', ')}
          sizes="46vw"
          alt={p.alt}
          decoding="async"
          draggable="false"
          onLoad={() => setOk(true)}
        />
      )}
    </div>
  )
}

function Face({ p, near, side, num, narrow }) {
  let body = null
  if (p.t === 'inv') {
    body = near ? <img className="fb-inv" src={p.src} alt={p.alt} decoding="async" draggable="false" /> : null
  } else if (p.t === 'photo') {
    body = (
      <div className="fb-mat">
        <Photo p={p} narrow={narrow} near={near} />
        <span className="fb-cap">{EVL[p.ev] || ''}</span>
      </div>
    )
  } else if (p.t === 'video') {
    body = (
      <div className="fb-mat fb-vid">
        {near && <video controls playsInline preload="none" poster={B + 'vid/' + p.id + '-poster.jpg'} src={B + p.file} />}
        <span className="fb-cap">{p.label}</span>
      </div>
    )
  } else if (p.t === 'end') {
    body = (
      <div className="fb-end">
        <span className="fb-end-ml">നന്ദി</span>
        <b>Amrutha &amp; Nithin Krishna</b>
        <i>Guruvayoor &middot; 25 October 2026</i>
      </div>
    )
  }
  return (
    <div className={`fb-face ${side}`}>
      {body}
      {num && p.t !== 'inv' && <span className="fb-num">{num}</span>}
    </div>
  )
}

export default function Flipbook({ items }) {
  const narrow = useNarrow()
  const [k, setK] = useState(0)
  const root = useRef(null)
  const seen = useRef(false)
  const start = useRef(null)

  const pages = useMemo(() => {
    const P = [
      { t: 'inv', src: B + 'album/inv-1.webp', alt: 'Wedding invitation, front' },
      { t: 'inv', src: B + 'album/inv-2.webp', alt: 'Wedding invitation, details' },
      ...items,
      { t: 'end' },
    ]
    if (!narrow && P.length % 2) P.splice(P.length - 1, 0, { t: 'blank' })
    return P
  }, [items, narrow])

  const leaves = useMemo(() => {
    if (narrow) return []
    const L = []
    for (let i = 0; i < pages.length; i += 2) L.push([pages[i], pages[i + 1]])
    return L
  }, [pages, narrow])

  const N = narrow ? pages.length : leaves.length
  const max = narrow ? N - 1 : N
  useEffect(() => setK(0), [narrow])
  const go = useCallback((d) => setK((x) => Math.max(0, Math.min(max, x + d))), [max])

  useEffect(() => {
    root.current && root.current.querySelectorAll('video').forEach((v) => v.pause())
  }, [k])

  // Phones: warm the cache for the next and previous few pages.
  useEffect(() => {
    if (!narrow) return
    for (let j = k - 2; j <= k + 3; j++) {
      const u = pages[j] && urlOf(pages[j], true)
      if (u) { const im = new Image(); im.decoding = 'async'; im.src = u }
    }
  }, [k, narrow, pages])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => (seen.current = e.intersectionRatio > 0.4), { threshold: [0, 0.4, 1] })
    io.observe(el)
    const key = (e) => {
      if (!seen.current || /^(INPUT|TEXTAREA|VIDEO)$/.test(document.activeElement && document.activeElement.tagName)) return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', key)
    return () => {
      io.disconnect()
      window.removeEventListener('keydown', key)
    }
  }, [go])

  const down = (e) => {
    if (e.target.closest('video')) return
    start.current = { x: e.clientX, y: e.clientY }
  }
  const up = (e) => {
    const s = start.current
    start.current = null
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1)
  }

  const shift = narrow ? 0 : k === 0 ? -25 : k === N ? 25 : 0
  const label = narrow
    ? `Page ${k + 1} of ${N}`
    : k === 0
      ? 'Cover'
      : k === N
        ? 'The end'
        : `Pages ${2 * k}\u2013${2 * k + 1} of ${pages.length}`

  return (
    <section className="album" id="album" ref={root}>
      <h3 className="vh">The album</h3>
      <p className="album-sub">Flip through the pages. Swipe, tap the page edges, use the arrows or your keyboard.</p>
      <div className={`fb ${narrow ? 'narrow' : ''}`}>
        <div className="fb-stage" onPointerDown={down} onPointerUp={up} onPointerCancel={() => (start.current = null)}>
          <div className="fb-book" style={{ transform: narrow ? undefined : `translateX(${shift}%)` }}>
            {narrow
              ? pages.map((p, i) => {
                  if (Math.abs(i - k) > 1) return null
                  return (
                    <div key={i} className={`fb-slide ${i < k ? 'prev' : i > k ? 'next' : 'cur'}`} aria-hidden={i !== k}>
                      <Face p={p} near={Math.abs(i - k) <= 1} side="front" num={i + 1} narrow />
                    </div>
                  )
                })
              : leaves.map(([f, b], i) => {
                  if (i < k - 2 || i > k + 2) return null
                  const flipped = i < k
                  return (
                    <div
                      key={i}
                      data-v={f.t === 'video' || (b && b.t === 'video') ? '1' : undefined}
                      className={`fb-leaf ${flipped ? 'flipped' : ''} ${i >= k - 2 && i <= k + 1 ? 'sh' : ''}`}
                      style={{ zIndex: flipped ? i + 1 : N - i + 1 }}
                    >
                      <Face p={f} near={Math.abs(i - k) <= 2} side="front" num={2 * i + 1} />
                      {b ? <Face p={b} near={Math.abs(i - k) <= 2} side="back" num={2 * i + 2} /> : <div className="fb-face back blank" />}
                    </div>
                  )
                })}
            <button className="fb-zone l" aria-label="Previous page" onClick={() => go(-1)} disabled={k === 0} />
            <button className="fb-zone r" aria-label="Next page" onClick={() => go(1)} disabled={k === max} />
          </div>
        </div>
        <div className="fb-ctl">
          <button onClick={() => go(-1)} disabled={k === 0} aria-label="Previous page">&#8592;</button>
          <span>{label}</span>
          <button onClick={() => go(1)} disabled={k === max} aria-label="Next page">&#8594;</button>
        </div>
      </div>
    </section>
  )
}
