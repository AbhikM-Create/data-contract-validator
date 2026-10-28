import { useRef } from 'react'
import { colors, ghostButton, label, mono, panel, sans } from '../theme.js'

// Building a reconciliation spec from dropdowns — never typed logic, the same
// principle as the rule builder: every choice is a column the files actually
// have, so nothing can be written that the engine cannot read. The spec's
// problems are shown as sentences while it is built, and reconciling is
// refused until there are none.

const OPS = [
  { id: '=', label: 'is' },
  { id: '!=', label: 'is not' },
  { id: '>', label: 'is above' },
  { id: '<', label: 'is below' },
  { id: 'notNull', label: 'is not blank' },
]

export default function SpecBuilder({ spec, sourceColumns, targetColumns, suggestions, issues, onChange, onCrosswalk }) {
  const set = (patch) => onChange({ ...spec, ...patch })
  const setKey = (side, index, value) => {
    const next = [...spec.key[side]]
    next[index] = value
    set({ key: { ...spec.key, [side]: next } })
  }
  const addKey = () => set({ key: { source: [...spec.key.source, ''], target: [...spec.key.target, ''] } })
  const removeKey = (index) => set({
    key: { source: spec.key.source.filter((_, i) => i !== index), target: spec.key.target.filter((_, i) => i !== index) },
  })

  const setField = (index, patch) => set({ mapping: spec.mapping.map((f, i) => (i === index ? { ...f, ...patch } : f)) })
  const removeField = (index) => set({ mapping: spec.mapping.filter((_, i) => i !== index) })
  const addField = () => set({ mapping: [...spec.mapping, { source: '', target: '' }] })
  const acceptSuggestions = () => set({ mapping: [...spec.mapping, ...suggestions] })

  const setTotal = (index, patch) => set({ totals: spec.totals.map((t, i) => (i === index ? { ...t, ...patch } : t)) })
  const removeTotal = (index) => set({ totals: spec.totals.filter((_, i) => i !== index) })
  const addTotal = () => set({ totals: [...spec.totals, { source: '', target: '' }] })

  const scope = spec.scope?.source
  const setScope = (patch) => set({ scope: { source: patch === null ? null : { ...(scope ?? { column: sourceColumns[0] ?? '', op: '=', target: '' }), ...patch } } })

  return (
    <div style={{ ...panel, padding: 18, marginTop: 12 }}>
      <Part title="Key" hint="The column that identifies a record on each side. Records are matched on it, so it must mean the same person, vendor or item in both systems.">
        {spec.key.source.map((_, i) => (
          <Row key={`key-${i}`}>
            <Pick value={spec.key.source[i]} options={sourceColumns} onChange={(v) => setKey('source', i, v)} placeholder="source column" />
            <Arrow />
            <Pick value={spec.key.target[i]} options={targetColumns} onChange={(v) => setKey('target', i, v)} placeholder="target column" />
            {spec.key.source.length > 1 && <Remove onClick={() => removeKey(i)} />}
          </Row>
        ))}
        <button onClick={addKey} style={{ ...ghostButton, marginTop: 6 }}>+ Add a key column</button>
        <Hint>Add a second column when a record is identified by two together — an employee and an effective date.</Hint>
      </Part>

      <Part title="Scope" hint="Which source records are meant to migrate. Records outside scope are counted and shown, never silently dropped.">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={Boolean(scope)} onChange={(e) => setScope(e.target.checked ? {} : null)} />
          <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>Only some source records migrate</span>
        </label>
        {scope && (
          <Row>
            <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>ONLY WHERE</span>
            <Pick value={scope.column} options={sourceColumns} onChange={(v) => setScope({ column: v })} />
            <select value={scope.op} onChange={(e) => setScope({ op: e.target.value })} style={control(130)}>
              {OPS.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
            </select>
            {scope.op !== 'notNull' && (
              <input value={scope.target ?? ''} onChange={(e) => setScope({ target: e.target.value })} placeholder="value" aria-label="scope value" style={{ ...control(120), fontFamily: mono }} />
            )}
          </Row>
        )}
      </Part>

      <Part title="Fields to compare" hint="Each source field and the target field it became. A crosswalk translates legacy codes first; a legacy code with no crosswalk entry is reported as a gap in the mapping, not as a load error.">
        {spec.mapping.length === 0 && <Hint>No fields yet — only presence (completeness) will be checked.</Hint>}
        {spec.mapping.map((field, i) => (
          <Row key={`field-${i}`}>
            <Pick value={field.source} options={sourceColumns} onChange={(v) => setField(i, { source: v })} placeholder="source field" />
            <Arrow />
            <Pick value={field.target} options={targetColumns} onChange={(v) => setField(i, { target: v })} placeholder="target field" />
            <input
              value={field.tolerance ?? ''}
              onChange={(e) => setField(i, { tolerance: e.target.value === '' ? undefined : e.target.value })}
              placeholder="± 0"
              aria-label={`tolerance for ${field.target || 'this field'}`}
              title="For numbers: how far apart the two values may be and still agree"
              style={{ ...control(70), fontFamily: mono }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }} title="Treat OKAFOR and Okafor as the same">
              <input type="checkbox" checked={Boolean(field.ignoreCase)} onChange={(e) => setField(i, { ignoreCase: e.target.checked || undefined })} />
              <span style={{ fontFamily: sans, fontSize: 12, color: colors.mute }}>ignore case</span>
            </label>
            <Crosswalk map={field.map} onFile={(file) => onCrosswalk({ field: i }, file)} onClear={() => setField(i, { map: undefined })} />
            <Remove onClick={() => removeField(i)} />
          </Row>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <button onClick={addField} style={ghostButton}>+ Map a field</button>
          {suggestions.length > 0 && (
            <button onClick={acceptSuggestions} style={{ ...ghostButton, color: colors.accent, borderColor: `${colors.accent}55` }}>
              Pair {suggestions.length} column{suggestions.length === 1 ? '' : 's'} with the same name
            </button>
          )}
        </div>
      </Part>

      <Part title="Control totals" hint="Sums that must still tie out, optionally per group — a company code, a cost centre. They catch what record matching misses: a whole group loaded in the wrong unit." last>
        {spec.totals.map((total, i) => (
          <Row key={`total-${i}`}>
            <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>SUM</span>
            <Pick value={total.source} options={sourceColumns} onChange={(v) => setTotal(i, { source: v })} placeholder="source amount" />
            <Arrow />
            <Pick value={total.target} options={targetColumns} onChange={(v) => setTotal(i, { target: v })} placeholder="target amount" />
            <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>BY</span>
            <Pick
              value={total.groupBy?.source ?? ''}
              options={sourceColumns}
              onChange={(v) => setTotal(i, { groupBy: v ? { ...(total.groupBy ?? {}), source: v, target: total.groupBy?.target ?? '' } : undefined })}
              placeholder="(all records)"
            />
            {total.groupBy && (
              <>
                <Arrow />
                <Pick value={total.groupBy.target} options={targetColumns} onChange={(v) => setTotal(i, { groupBy: { ...total.groupBy, target: v } })} placeholder="target group" />
                <Crosswalk map={total.groupBy.map} onFile={(file) => onCrosswalk({ total: i }, file)} onClear={() => setTotal(i, { groupBy: { ...total.groupBy, map: undefined } })} />
              </>
            )}
            <Remove onClick={() => removeTotal(i)} />
          </Row>
        ))}
        <button onClick={addTotal} style={{ ...ghostButton, marginTop: 6 }}>+ Add a control total</button>
      </Part>

      <div style={{ marginTop: 16, padding: '10px 12px', background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6 }}>
        {issues.length === 0 ? (
          <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>The spec is complete and can run against these files.</span>
        ) : (
          <>
            <div style={label}>Before this can run</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {issues.map((issue) => (
                <li key={issue} style={{ fontFamily: sans, fontSize: 13, color: colors.warn, lineHeight: 1.5 }}>{issue}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function Part({ title, hint, children, last }) {
  return (
    <section style={{ paddingBottom: last ? 0 : 16, marginBottom: last ? 0 : 16, borderBottom: last ? 'none' : `1px solid ${colors.panelEdge}` }}>
      <h3 style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink, margin: 0 }}>{title}</h3>
      <p style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, color: colors.faint, margin: '4px 0 10px', maxWidth: 720 }}>{hint}</p>
      {children}
    </section>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>{children}</div>
}

function Hint({ children }) {
  return <p style={{ fontFamily: sans, fontSize: 12, color: colors.faint, margin: '6px 0 0' }}>{children}</p>
}

function Arrow() {
  return <span aria-hidden="true" style={{ fontFamily: mono, fontSize: 13, color: colors.faint }}>→</span>
}

function Remove({ onClick }) {
  return <button onClick={onClick} style={{ ...ghostButton, fontSize: 11, padding: '4px 8px' }}>remove</button>
}

const control = (width) => ({
  width,
  background: colors.ground,
  border: `1px solid ${colors.panelEdge}`,
  borderRadius: 6,
  color: colors.ink,
  fontFamily: sans,
  fontSize: 13,
  padding: '7px 8px',
  outline: 'none',
})

function Pick({ value, options, onChange, placeholder = 'choose a column' }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ ...control(176), fontFamily: mono, cursor: 'pointer' }}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
      {/* A column the spec names but the file lacks stays visible, so the
          problem is on screen rather than silently reset to blank. */}
      {value && !options.includes(value) && <option value={value}>{value} (not in file)</option>}
    </select>
  )
}

function Crosswalk({ map, onFile, onClear }) {
  const input = useRef(null)
  const entries = map ? Object.keys(map).length : 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input ref={input} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = '' }} />
      {entries > 0 ? (
        <>
          <span style={{ fontFamily: sans, fontSize: 12, color: colors.accent }} title={Object.entries(map).slice(0, 8).map(([a, b]) => `${a} → ${b}`).join('\n')}>
            crosswalk · {entries} value{entries === 1 ? '' : 's'}
          </span>
          <button onClick={() => input.current?.click()} style={{ ...ghostButton, fontSize: 11, padding: '4px 8px' }}>replace</button>
          <button onClick={onClear} style={{ ...ghostButton, fontSize: 11, padding: '4px 8px' }}>clear</button>
        </>
      ) : (
        <button onClick={() => input.current?.click()} style={{ ...ghostButton, fontSize: 11.5, padding: '5px 9px' }} title="A two-column CSV: legacy value, then the value it becomes">
          + crosswalk CSV
        </button>
      )}
    </span>
  )
}
