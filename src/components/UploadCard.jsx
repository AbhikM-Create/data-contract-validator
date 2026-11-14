import { useRef, useState } from 'react'
import { colors, mono, panel, sans, tint } from '../theme.js'

// One numbered step with an unmistakable upload button. Drag-and-drop still
// works on the whole card, but it is the fallback, not the only way in —
// a first-time reader should not have to guess that the panel is a drop target.
export default function UploadCard({ step, title, tag, hint, file, accent, onFile, onClear, onWorkbook }) {
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
        borderColor: dragging ? accent : failed ? colors.fail : loaded ? `${tint(colors.pass, '55')}` : colors.panelEdge,
        padding: 16,
        transition: 'border-color 120ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
            background: loaded ? colors.pass : accent,
            color: colors.ground, fontFamily: mono, fontSize: 12, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {loaded ? '✓' : step}
        </span>
        <span style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{title}</span>
        <span
          style={{
            fontFamily: mono, fontSize: 12, color: colors.faint,
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
            <div style={{ fontFamily: mono, fontSize: 12, color: colors.faint, marginTop: 3 }}>
              {file.rowCount.toLocaleString('en-US')} rows &middot; {file.columns.length} columns
              {file.kind === 'xlsx' && <> &middot; sheet “{file.sheet}”, header row {file.headerRow}</>}
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
            <span style={{ fontSize: 14 }}>&#8593;</span> Upload CSV or Excel file
          </button>
          <p style={{ fontFamily: sans, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 8 }}>
            or drag a .csv or .xlsx file onto this panel
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        data-upload={tag}
        onChange={(e) => { take(e.target.files); e.target.value = '' }}
        style={{ display: 'none' }}
      />

      {failed && (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.fail, lineHeight: 1.5, marginTop: 12 }}>
          {file.errors[0]}
        </p>
      )}

      {/* A workbook: which sheet and which row holds the names. Offered after a
          refusal too, because choosing the right ones is usually the fix. */}
      {file?.kind === 'xlsx' && onWorkbook && <WorkbookChoice file={file} tag={tag} onChange={onWorkbook} />}
      {file?.kind === 'xlsx' && file.notes?.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {file.notes.map((note) => (
            <li key={note} style={{ fontFamily: sans, fontSize: 12, color: colors.warn, lineHeight: 1.5 }}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const HEADER_ROWS = Array.from({ length: 20 }, (_, i) => i + 1)

function WorkbookChoice({ file, tag, onChange }) {
  const select = {
    background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6, color: colors.ink,
    fontFamily: mono, fontSize: 12, padding: '5px 6px', cursor: 'pointer', maxWidth: 220,
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
      <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>Read</span>
      <select
        aria-label={`sheet to read — ${tag}`}
        value={file.sheet ?? ''}
        onChange={(e) => onChange({ sheet: e.target.value, headerRow: file.headerRow ?? 1 })}
        style={select}
      >
        {(file.sheets ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}{s.hidden ? ' (hidden)' : ''}</option>)}
      </select>
      <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>with column names in row</span>
      <select
        aria-label={`header row — ${tag}`}
        value={file.headerRow ?? 1}
        onChange={(e) => onChange({ sheet: file.sheet, headerRow: Number(e.target.value) })}
        style={select}
      >
        {HEADER_ROWS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  )
}

const secondaryButton = {
  background: 'transparent',
  border: `1px solid ${colors.panelEdge}`,
  color: colors.mute,
  fontFamily: sans,
  fontSize: 13,
  padding: '7px 12px',
  borderRadius: 6,
  cursor: 'pointer',
}
