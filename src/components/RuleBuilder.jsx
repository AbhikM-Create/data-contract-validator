import { useMemo, useState } from 'react'
import { RULE_KINDS, RULE_TYPES, describeRule, ruleIssue } from '../lib/rules.js'
import { colors, mono, sans } from '../theme.js'

// Composing a rule from dropdowns — never a typed expression. Every rule the
// v2 set supports is a choice of column, operator and target, so the builder
// offers exactly those and nothing can be written that the engine can't read.

const KINDS = [
  { id: RULE_KINDS.VALUE_SET, label: 'must be one of a fixed list', hint: 'The complete set of values this column is allowed to hold.' },
  { id: RULE_KINDS.NULL_RULE, label: 'must never be blank', hint: 'The column has to carry a value.' },
  { id: RULE_KINDS.CROSS_COLUMN, label: 'must compare to another column', hint: 'Two columns in the same row that have to agree — an end date after a start date.' },
  { id: RULE_KINDS.COMPARISON, label: 'must compare to a fixed value', hint: 'A bound the column can never cross.' },
  { id: RULE_KINDS.RANGE, label: 'must fall between two values', hint: 'An allowed range, inclusive at both ends.' },
  { id: RULE_KINDS.TYPE, label: 'must hold one kind of value', hint: 'Numbers, dates or true/false — rejects anything that will not parse.' },
]

const COMPARISON_OPS = [
  { id: '=', label: 'equal to' },
  { id: '!=', label: 'different from' },
  { id: '>', label: 'greater than' },
  { id: '<', label: 'less than' },
  { id: '>=', label: 'at least' },
  { id: '<=', label: 'at most' },
]

const blank = (columns) => ({
  kind: RULE_KINDS.VALUE_SET,
  column: columns[0] ?? '',
  op: 'in',
  target: '',
  targetIsColumn: false,
  whenOn: false,
  when: { column: columns[0] ?? '', op: '=', target: '', targetIsColumn: false },
})

// The draft carries UI-only fields (a comma-separated string for value sets, a
// whenOn switch). This turns it into the plain rule object the engine reads.
function toRule(draft) {
  const rule = { kind: draft.kind, column: draft.column, op: draft.op }

  if (draft.kind === RULE_KINDS.VALUE_SET) {
    rule.op = 'in'
    rule.target = String(draft.target).split(',').map((v) => v.trim()).filter(Boolean)
  } else if (draft.kind === RULE_KINDS.RANGE) {
    rule.op = 'between'
    rule.target = [draft.low, draft.high].map((v) => (String(v).trim() === '' ? '' : v))
  } else if (draft.kind === RULE_KINDS.NULL_RULE) {
    rule.op = 'notNull'
    rule.target = null
  } else if (draft.kind === RULE_KINDS.TYPE) {
    rule.op = '='
    rule.target = draft.target || RULE_TYPES[0]
  } else {
    rule.target = draft.target
    rule.targetIsColumn = draft.kind === RULE_KINDS.CROSS_COLUMN ? true : !!draft.targetIsColumn
  }

  if (draft.kind === RULE_KINDS.CROSS_COLUMN) rule.targetIsColumn = true

  if (draft.whenOn && draft.when.column) {
    rule.when = {
      column: draft.when.column,
      op: draft.when.op,
      target: draft.when.op === 'notNull' ? null : draft.when.target,
      targetIsColumn: !!draft.when.targetIsColumn,
    }
  }
  return rule
}

export default function RuleBuilder({ columns, onAdd, onCancel }) {
  const [draft, setDraft] = useState(() => blank(columns))
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const setWhen = (patch) => setDraft((current) => ({ ...current, when: { ...current.when, ...patch } }))

  const rule = useMemo(() => toRule(draft), [draft])
  const issue = ruleIssue(rule)
  const kind = KINDS.find((k) => k.id === draft.kind)

  const otherColumns = columns.filter((name) => name !== draft.column)

  return (
    <div style={{ background: colors.panelSunk, border: `1px solid ${colors.panelEdge}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Select value={draft.column} onChange={(v) => set({ column: v })} options={columns.map((c) => ({ id: c, label: c }))} width={172} mono />
        <Select value={draft.kind} onChange={(v) => set({ kind: v, target: '', targetIsColumn: v === RULE_KINDS.CROSS_COLUMN })} options={KINDS.map((k) => ({ id: k.id, label: k.label }))} width={232} />

        {draft.kind === RULE_KINDS.VALUE_SET && (
          <Field
            value={draft.target}
            onChange={(v) => set({ target: v })}
            placeholder="Analyst, VP, Owner"
            width={260}
            label="allowed values, comma separated"
          />
        )}

        {draft.kind === RULE_KINDS.TYPE && (
          <Select value={draft.target || RULE_TYPES[0]} onChange={(v) => set({ target: v })} options={RULE_TYPES.map((t) => ({ id: t, label: t }))} width={120} />
        )}

        {(draft.kind === RULE_KINDS.COMPARISON || draft.kind === RULE_KINDS.CROSS_COLUMN) && (
          <>
            <Select value={draft.op === 'in' ? '=' : draft.op} onChange={(v) => set({ op: v })} options={COMPARISON_OPS} width={140} />
            {draft.kind === RULE_KINDS.CROSS_COLUMN ? (
              <Select value={draft.target} onChange={(v) => set({ target: v })} options={otherColumns.map((c) => ({ id: c, label: c }))} width={172} mono placeholder="pick a column" />
            ) : (
              <Field value={draft.target} onChange={(v) => set({ target: v })} placeholder="0" width={120} label="value" />
            )}
          </>
        )}

        {draft.kind === RULE_KINDS.RANGE && (
          <>
            <Field value={draft.low ?? ''} onChange={(v) => set({ low: v })} placeholder="low" width={96} label="low" />
            <Field value={draft.high ?? ''} onChange={(v) => set({ high: v })} placeholder="high" width={96} label="high" />
          </>
        )}
      </div>

      {kind && <p style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 8 }}>{kind.hint}</p>}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.whenOn} onChange={(e) => set({ whenOn: e.target.checked })} />
        <span style={{ fontFamily: sans, fontSize: 13, color: colors.ink }}>Only check this rule on some rows</span>
      </label>

      {draft.whenOn && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10, paddingLeft: 24 }}>
          <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>WHEN</span>
          <Select value={draft.when.column} onChange={(v) => setWhen({ column: v })} options={columns.map((c) => ({ id: c, label: c }))} width={172} mono />
          <Select
            value={draft.when.op}
            onChange={(v) => setWhen({ op: v })}
            options={[...COMPARISON_OPS, { id: 'notNull', label: 'is not blank' }]}
            width={140}
          />
          {draft.when.op !== 'notNull' && (
            <Field value={draft.when.target} onChange={(v) => setWhen({ target: v })} placeholder="N" width={120} label="value" />
          )}
        </div>
      )}

      <div style={{ marginTop: 14, padding: '10px 12px', background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6 }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: colors.faint, letterSpacing: '0.06em' }}>THE RULE READS</div>
        <div style={{ fontFamily: sans, fontSize: 13.5, color: issue ? colors.faint : colors.ink, marginTop: 6 }}>
          {issue ? 'Not finished yet.' : describeRule(rule)}
        </div>
        {issue && <div style={{ fontFamily: sans, fontSize: 12, color: colors.warn, marginTop: 6 }}>{capitalise(issue)}.</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onAdd(rule)}
          disabled={!!issue}
          style={{
            background: issue ? 'transparent' : colors.accent,
            color: issue ? colors.faint : colors.ground,
            border: issue ? `1px solid ${colors.panelEdge}` : 'none',
            borderRadius: 7, padding: '9px 16px', fontFamily: sans, fontSize: 13, fontWeight: 600,
            cursor: issue ? 'default' : 'pointer',
          }}
        >
          Add this rule
        </button>
        <button
          onClick={onCancel}
          style={{ background: 'transparent', border: `1px solid ${colors.panelEdge}`, color: colors.mute, borderRadius: 7, padding: '9px 14px', fontFamily: sans, fontSize: 13, cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function capitalise(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

const controlStyle = (width) => ({
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

function Select({ value, onChange, options, width, mono: isMono, placeholder }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...controlStyle(width), fontFamily: isMono ? mono : sans, cursor: 'pointer' }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  )
}

function Field({ value, onChange, placeholder, width, label }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...controlStyle(width), fontFamily: mono }}
    />
  )
}
