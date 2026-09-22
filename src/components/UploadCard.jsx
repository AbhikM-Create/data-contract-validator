import { useRef, useState } from 'react'
import { colors, mono, panel, sans } from '../theme.js'

// One numbered step with an unmistakable upload button. Drag-and-drop still
// works on the whole card, but it is the fallback, not the only way in —
// a first-time reader should not have to guess that the panel is a drop target.
export default function UploadCard({ step, title, tag, hint, file, accent, onFile, onClear }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const take = (list) => {
    const picked = list?.[0]
    if (picked) onFile(picked)
  }

  const loaded = file && file.rowCount > 0
  const failed = file && file.errors.length > 0

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files) }}
      style={{
        ...panel,
        borderColor: dragging ? accent : failed ? colors.fail : loaded ? `${colors.pass}55` : colors.panelEdge,
        padding: 16,
        transition: 'border-color 120ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
            background: loaded ? colors.pass : accent,
            color: colors.ground, fontFamily: mono, fontSize: 11, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {loaded ? '✓' : step}
        </span>
        <span style={{ fontFamily: sans, fontSize: 15, fontWeight: 600, color: colors.ink }}>{title}</span>
        <span
          style={{
            fontFamily: mono, fontSize: 10, color: colors.faint,
            border: `1px solid ${colors.panelEdge}`, borderRadius: 4, padding: '2px 6px',
          }}
          title={`The report calls this file the ${tag}.`}
        >
          {tag}
        </span>
      </div>

      <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.45, margin: '8px 0 14px' }}>{hint}</p>

      {loaded ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontFamily: mono, fontSize: 13, color: colors.ink, wordBreak: 'break-all' }}>{file.name}</div>
            <div style={{ fontFamily: mono, fontSize: 11.5, color: colors.faint, marginTop: 3 }}>
              {file.rowCount.toLocaleString('en-US')} rows &middot; {file.columns.length} columns
            </div>
          </div>
          <button onClick={() => inputRef.current?.click()} style={secondaryButton}>Replace</button>
          <button onClick={onClear} style={secondaryButton}>Remove</button>
        </div>
      ) : (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: accent, color: colors.ground, border: 'none', borderRadius: 8,
              fontFamily: sans, fontSize: 14, fontWeight: 600, padding: '12px 16px', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 15 }}>&#8593;</span> Upload CSV file
          </button>
          <p style={{ fontFamily: sans, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 8 }}>
            or drag a .csv file onto this panel
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => { take(e.target.files); e.target.value = '' }}
        style={{ display: 'none' }}
      />

      {failed && (
        <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.fail, lineHeight: 1.5, marginTop: 12 }}>
          {file.errors[0]}
        </p>
      )}
    </div>
  )
}

const secondaryButton = {
  background: 'transparent',
  border: `1px solid ${colors.panelEdge}`,
  color: colors.mute,
  fontFamily: sans,
  fontSize: 12.5,
  padding: '7px 12px',
  borderRadius: 6,
  cursor: 'pointer',
}
