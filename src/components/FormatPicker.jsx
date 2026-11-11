import { DATE_FORMATS, DECIMALS, ENCODINGS, GROUPINGS } from '../lib/formats.js'
import { colors, mono, sans } from '../theme.js'

// How one file is written: its encoding, its number notation, its date order.
// Declared, never guessed — a German extract's 1.234,56 read the US way is not
// an error, it is a different number. Left undeclared, a value that could be
// read two ways stays text, so it shows up as a disagreement, not a guess.

export default function FormatPicker({ format, onChange, label = 'Read this file as' }) {
  const set = (part, value) => {
    const next = { ...format }
    if (value) next[part] = value
    else delete next[part]
    // A decimal comma and Indian grouping never go together (formatIssue).
    if (part === 'decimal' && value === ',') delete next.grouping
    onChange(next)
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
      <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>{label}</span>
      <Choice value={format.encoding ?? ''} onChange={(v) => set('encoding', v)} options={ENCODINGS} empty="UTF-8" label="encoding" width={150} />
      <Choice value={format.decimal ?? ''} onChange={(v) => set('decimal', v)} options={DECIMALS} empty="1,234.56" label="number notation" width={128} />
      <Choice value={format.date ?? ''} onChange={(v) => set('date', v)} options={DATE_FORMATS} empty="ISO dates only" label="date format" width={150} />
      {/* Indian grouping is written with a decimal point, so it is offered only then. */}
      {format.decimal !== ',' && (
        <Choice value={format.grouping ?? ''} onChange={(v) => set('grouping', v)} options={GROUPINGS} empty="1,234,567" label="digit grouping" width={150} />
      )}
    </div>
  )
}

function Choice({ value, onChange, options, empty, label, width }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={options.find((o) => o.id === value)?.label ?? empty}
      style={{
        width, background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6,
        color: colors.ink, fontFamily: mono, fontSize: 12, padding: '5px 6px', cursor: 'pointer',
      }}
    >
      <option value="">{empty}</option>
      {options.filter((o) => o.id !== 'utf-8' && o.id !== '.' && o.id !== 'western').map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}
