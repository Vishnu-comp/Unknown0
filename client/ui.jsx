import { useState } from 'react';

export function Panel({ title, sub, right, children, foot }) {
  return (
    <section className="panel">
      {(title || right) && (
        <header className="panel-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {sub && <p>{sub}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="panel-body">{children}</div>
      {foot && <div className="panel-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>{foot}</div>}
    </section>
  );
}

export function Field({ label, hint, children, wide }) {
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Input({ value, onChange, ...rest }) {
  return <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

/** Renamed from `Number` on purpose — an export called Number shadows the
 * global constructor inside this module and breaks Number.isNaN at runtime. */
export function NumField({ value, onChange, ...rest }) {
  return <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} {...rest} />;
}

export function Area({ value, onChange, rows = 4, ...rest }) {
  return (
    <textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>
        <div style={{ fontWeight: 560 }}>{label}</div>
        {hint && <div className="dim small">{hint}</div>}
      </span>
    </label>
  );
}

export function Chips({ items = [], onRemove, tone }) {
  if (!items.length) return <span className="dim small">none</span>;
  return (
    <div className="job-bits" style={{ marginTop: 0 }}>
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className={`chip ${tone || ''} ${onRemove ? 'rm' : ''}`} onClick={() => onRemove && onRemove(it)} title={onRemove ? 'click to remove' : undefined}>
          {it}
          {onRemove && ' ×'}
        </span>
      ))}
    </div>
  );
}

export function Ring({ score, size = 54 }) {
  const grade = score >= 85 ? 'a' : score >= 72 ? 'b' : score >= 58 ? 'c' : 'd';
  return (
    <div className={`ring ${grade}`} style={{ '--p': Math.max(2, Math.min(100, score || 0)), width: size, height: size }}>
      <span>{score ?? '–'}</span>
    </div>
  );
}

export function Bar({ value, max = 100, label }) {
  const pctv = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div>
      {label && (
        <div className="flexr" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
          <span>{label}</span>
          <span className="mono">{value}/{max}</span>
        </div>
      )}
      <div className="bar">
        <i style={{ width: `${pctv}%` }} />
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={wide ? { width: 'min(1180px, 98%)' } : undefined}>
        <header className="panel-head">
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
          </div>
          <button className="btn sm ghost" onClick={onClose}>
            Close ✕
          </button>
        </header>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ text = 'working…' }) {
  return (
    <span className="flexr dim small">
      <span className="spinner" /> {text}
    </span>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flexr wrap" style={{ gap: 6 }}>
      {tabs.map((t) => (
        <button key={t.id} className={`btn sm ${active === t.id ? 'primary' : 'ghost'}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null && <span className="dim">· {t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function useLocal(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(`applyflow:${key}`);
      return s ? JSON.parse(s) : initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (next) =>
      setV((cur) => {
        const val = typeof next === 'function' ? next(cur) : next;
        try {
          localStorage.setItem(`applyflow:${key}`, JSON.stringify(val));
        } catch {}
        return val;
      }),
  ];
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 40 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

/**
 * "how long ago was this posted", for whichever shape `postedAt` happens to be in.
 * The old call site did `timeAgo(postedAt + 'T00:00:00Z')`, which is correct for the
 * date-only strings the key'd sources produce and *broken* for a full timestamp:
 * "2026-09-15T12:57:17.897Z" + "T00:00:00Z" parses to NaN, so every job harvested
 * from the browser — the only path that gets live LinkedIn/Naukri postings in —
 * rendered "🗓 —" instead of its age. Appending nothing is safe for both shapes,
 * because Date.parse reads a bare YYYY-MM-DD fine.
 */
export function postedAgo(postedAt) {
  if (!postedAt) return '—';
  const iso = String(postedAt).includes('T') ? String(postedAt) : `${String(postedAt).slice(0, 10)}T00:00:00Z`;
  const out = timeAgo(iso);
  return out === '—' ? timeAgo(String(postedAt).slice(0, 10)) : out;
}

export function fmtMoney(n, cur) {
  if (!n) return null;
  const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£', SGD: 'S$', AUD: 'A$', CAD: 'C$' }[cur] || '';
  if (cur === 'INR' && n >= 100000) return `${sym}${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L`;
  if (n >= 1000) return `${sym}${Math.round(n / 1000)}k`;
  return `${sym}${n}`;
}
