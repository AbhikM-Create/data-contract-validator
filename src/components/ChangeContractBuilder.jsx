import { colors, ghostButton, mono, panel, sans } from '../theme.js'

// Building a change contract from dropdowns: every column is one the files
// actually have, so nothing can be written that the engine cannot read. The
// one fact the contract rests on is said first and never folded away — every
// column not listed here must stay exactly as it was.

const COVERAGE = [
  { id: 'none', label: 'none may be' },
  { id: 'listed', label: 'only those on the approved list may be' },
  { id: 'any', label: 'any may be' },
]

// The policies a person can choose here. "map" (a crosswalk) is read from a
// contract file and shown, but not authored on this screen yet.
const POLICIES = [
  { id: 'free', label: 'may change freely' },
  { id: 'oneOf', label: 'may change, only to one of a list' },
  { id: 'bounded', label: 'may change, within limits' },
  { id: 'asApproved', label: 'must change to its approved value' },
  { id: 'preserve', label: 'must stay the same' },
]

const DIRECTIONS = [
  { id: 'either', label: 'up or down' },
  { id: 'up', label: 'up only' },
  { id: 'down', label: 'down only' },
]

const asNumber = (text) => {
  if (String(text).trim() === '') return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}
const without = (o, ...names) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !names.includes(k) && v !== undefined))

export default function ChangeContractBuilder({ contract, beforeColumns, afterColumns, approvedColumns, issues, onChange }) {
  const key = Array.isArray(contract.key) ? contract.key : []
  const fields = Object.entries(contract.fields ?? {})
  const totals = contract.totals ?? []
  const named = new Set([...key, ...fields.map(([column]) => column)])
  const free = beforeColumns.filter((c) => !named.has(c))
  const usesApproved = contract.added === 'listed' || contract.removed === 'listed'
    || fields.some(([, f]) => f.policy === 'asApproved' || f.onlyFor === 'approved')

  // The approved list is keyed like the records, unless the contract says
  // otherwise; set when something first depends on it.
  const set = (patch) => {
    const next = { ...contract, ...patch }
    const needs = next.added === 'listed' || next.removed === 'listed'
      || Object.values(next.fields ?? {}).some((f) => f.policy === 'asApproved' || f.onlyFor === 'approved')
    if (needs && !next.approved) next.approved = { key: next.key ?? [] }
    if (next.approved && JSON.stringify(contract.approved?.key) === JSON.stringify(contract.key)) next.approved = { key: next.key ?? [] }
    onChange(next)
  }
  const setKey = (index, value) => set({ key: key.map((k, i) => (i === index ? value : k)) })
  const setFields = (list) => set({ fields: Object.fromEntries(list) })
  const setField = (index, patch) => setFields(fields.map(([c, f], i) => (i === index ? [c, without({ ...f, ...patch })] : [c, f])))
  const renameField = (index, column) => setFields(fields.map(([c, f], i) => (i === index ? [column, f] : [c, f])))
  const setTotal = (index, patch) => set({ totals: totals.map((t, i) => (i === index ? without({ ...t, ...patch }) : t)) })

  return (
    <div style={{ ...panel, padding: 18, marginTop: 12 }}>
      <Part title="Name" hint="What this change is — it heads the report.">
        <input aria-label="Contract name" value={contract.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="FY27 salary revision" style={{ ...control(320) }} />
      </Part>

      <Part title="Key" hint="The column that identifies a record in both files. Records are matched on it, so it must mean the same employee, account or item before and after.">
        {(key.length ? key : ['']).map((k, i) => (
          <Row key={`key-${i}`}>
            <Pick label={`Key column ${i + 1}`} value={k} options={beforeColumns} onChange={(v) => (key.length ? setKey(i, v) : set({ key: [v] }))} />
            {key.length > 1 && <Remove onClick={() => set({ key: key.filter((_, j) => j !== i) })} />}
          </Row>
        ))}
        {key.length > 0 && <button onClick={() => set({ key: [...key, ''] })} style={{ ...ghostButton, marginTop: 6 }}>+ Add a key column</button>}
      </Part>

      <Part title="Records" hint="Whether the change may add or remove whole records. None is the safe answer: a record that appears or vanishes is reported.">
        <Row>
          <span style={text}>Added records:</span>
          <Choice label="Added records" value={contract.added ?? 'none'} options={COVERAGE} onChange={(v) => set({ added: v })} />
          <span style={text}>added.</span>
        </Row>
        <Row>
          <span style={text}>Removed records:</span>
          <Choice label="Removed records" value={contract.removed ?? 'none'} options={COVERAGE} onChange={(v) => set({ removed: v })} />
          <span style={text}>removed.</span>
        </Row>
      </Part>

      <Part title="What may change" hint="List each column the change is allowed to touch, and how.">
        <p style={{ ...text, fontWeight: 600, color: colors.ink, margin: '0 0 4px' }}>
          Every column not listed here must stay exactly as it was.
        </p>
        {fields.map(([column, f], i) => (
          <div key={`field-${i}`} style={{ borderTop: i ? `1px dashed ${colors.panelEdge}` : 'none', paddingTop: i ? 8 : 0, marginTop: i ? 8 : 0 }}>
            <Row>
              <Pick label={`Changing column ${i + 1}`} value={column} options={[column, ...free].filter(Boolean)} onChange={(v) => renameField(i, v)} />
              {f.policy === 'map'
                ? <span style={text}>changes through a crosswalk of {Object.keys(f.map ?? {}).length} values (from the contract file)</span>
                : <Choice label={`What may happen to ${column || `column ${i + 1}`}`} value={f.policy ?? 'preserve'} options={POLICIES} onChange={(v) => setField(i, { policy: v })} />}
              <Remove onClick={() => setFields(fields.filter((_, j) => j !== i))} />
            </Row>
            <PolicyDetail column={column} field={f} approvedColumns={approvedColumns} onChange={(patch) => setField(i, patch)} />
          </div>
        ))}
        <button onClick={() => setFields([...fields, [free[0] ?? '', { policy: 'free' }]])} disabled={free.length === 0} style={{ ...ghostButton, marginTop: 10 }}>+ Allow a column to change</button>
      </Part>

      <Part title="Change log" hint="If whoever made the change keeps a log of the records they touched, every change must be in it, and every logged record must have changed.">
        <label style={{ ...text, display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={Boolean(contract.changeLog)} onChange={(e) => set({ changeLog: e.target.checked ? {} : undefined })} />
          Every change must be in the change log (keyed by the same column)
        </label>
      </Part>

      <Part title="Totals" hint="The net effect, summed over every record: a total that must not move, or may move only within limits." last={!usesApproved}>
        {totals.map((t, i) => (
          <Row key={`total-${i}`}>
            <span style={text}>The total of</span>
            <Pick label={`Total ${i + 1} column`} value={t.column} options={beforeColumns.filter((c) => afterColumns.includes(c))} onChange={(v) => setTotal(i, { column: v })} />
            <Choice label={`Total ${i + 1} rule`} value={t.compare ?? 'equal'} options={[{ id: 'equal', label: 'must stay the same' }, { id: 'delta', label: 'may change by' }]} onChange={(v) => setTotal(i, { compare: v })} />
            {t.compare === 'delta'
              ? <><Num label={`Total ${i + 1} at least`} value={t.min} placeholder="at least" onChange={(v) => setTotal(i, { min: v })} /><Num label={`Total ${i + 1} at most`} value={t.max} placeholder="at most" onChange={(v) => setTotal(i, { max: v })} /></>
              : <><span style={text}>give or take</span><Num label={`Total ${i + 1} tolerance`} value={t.tolerance} placeholder="0" onChange={(v) => setTotal(i, { tolerance: v })} /></>}
            <Remove onClick={() => set({ totals: totals.filter((_, j) => j !== i) })} />
          </Row>
        ))}
        <button onClick={() => set({ totals: [...totals, { column: '', compare: 'equal' }] })} style={{ ...ghostButton, marginTop: 6 }}>+ Add a total</button>
      </Part>

      {usesApproved && (
        <Part title="Approved list" hint="The list the signer approved, opened above. Its records are matched on the same key." last>
          <p style={{ ...text, margin: 0 }}>
            {approvedColumns.length
              ? `Matched on ${(contract.approved?.key ?? key).map((k) => `"${k}"`).join(' and ') || 'the key'}.`
              : 'Open the approved list above: without it, approvals cannot be checked and the result is "not confirmed".'}
          </p>
        </Part>
      )}

      {issues.length > 0 && (
        <div role="status" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 6, background: colors.panelSunk }}>
          <p style={{ ...text, fontWeight: 600, color: colors.ink, margin: 0 }}>Before this can run:</p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {issues.map((issue) => <li key={issue} style={{ ...text, marginTop: 2 }}>{issue}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function PolicyDetail({ column, field, approvedColumns, onChange }) {
  const name = column || 'this column'
  const onlyApproved = (
    <label style={{ ...text, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={field.onlyFor === 'approved'} onChange={(e) => onChange({ onlyFor: e.target.checked ? 'approved' : undefined })} />
      only for records on the approved list
    </label>
  )
  if (field.policy === 'free') return <Row>{onlyApproved}</Row>
  if (field.policy === 'oneOf') {
    return (
      <Row>
        <input
          aria-label={`Values ${name} may change to`}
          value={(field.values ?? []).join(', ')}
          onChange={(e) => onChange({ values: e.target.value.split(',').map((v) => v.trim()).filter((v, i, all) => v !== '' || i < all.length - 1) })}
          placeholder="Travel, Meals, Office"
          style={{ ...control(300), fontFamily: mono }}
        />
        <span style={{ ...text, fontSize: 12, color: colors.faint }}>separated by commas</span>
        {onlyApproved}
      </Row>
    )
  }
  if (field.policy === 'bounded') {
    return (
      <Row>
        <Choice label={`Direction ${name} may move`} value={field.direction ?? 'either'} options={DIRECTIONS} onChange={(v) => onChange({ direction: v })} />
        <span style={text}>by at most</span>
        <Num label={`Most ${name} may change, in percent`} value={field.maxPercent} placeholder="%" onChange={(v) => onChange({ maxPercent: v })} />
        <span style={text}>% and</span>
        <Num label={`Most ${name} may change, as an amount`} value={field.max} placeholder="amount" onChange={(v) => onChange({ max: v })} />
        {onlyApproved}
      </Row>
    )
  }
  if (field.policy === 'asApproved') {
    return (
      <Row>
        <span style={text}>The approved value is in the approved list's column</span>
        <Pick label={`Approved column for ${name}`} value={field.approvedColumn ?? column} options={approvedColumns.length ? approvedColumns : [column].filter(Boolean)} onChange={(v) => onChange({ approvedColumn: v === column ? undefined : v })} />
      </Row>
    )
  }
  return null
}

function Part({ title, hint, children, last }) {
  return (
    <section style={{ paddingBottom: last ? 0 : 16, marginBottom: last ? 0 : 16, borderBottom: last ? 'none' : `1px solid ${colors.panelEdge}` }}>
      <h3 style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink, margin: 0 }}>{title}</h3>
      <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: colors.faint, margin: '4px 0 10px', maxWidth: 720 }}>{hint}</p>
      {children}
    </section>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>{children}</div>
}

function Remove({ onClick }) {
  return <button onClick={onClick} style={{ ...ghostButton, fontSize: 12, padding: '4px 8px' }}>remove</button>
}

function Pick({ value, options, onChange, label }) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ ...control(196), fontFamily: mono, cursor: 'pointer' }}>
      <option value="">choose a column</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
      {/* A column the contract names but the file lacks stays visible, so the
          problem is on screen rather than silently reset to blank. */}
      {value && !options.includes(value) && <option value={value}>{value} (not in file)</option>}
    </select>
  )
}

function Choice({ value, options, onChange, label }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...control(), cursor: 'pointer' }}>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

function Num({ value, onChange, label, placeholder }) {
  return (
    <input
      type="number"
      aria-label={label}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(asNumber(e.target.value))}
      style={{ ...control(96), fontFamily: mono }}
    />
  )
}

const text = { fontFamily: sans, fontSize: 13, color: colors.mute }

const control = (width) => ({
  ...(width ? { width } : {}),
  background: colors.ground,
  border: `1px solid ${colors.control}`,
  borderRadius: 6,
  color: colors.ink,
  fontFamily: sans,
  fontSize: 13,
  padding: '7px 9px',
})
