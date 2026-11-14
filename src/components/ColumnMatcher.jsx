import { columnMapIssues, proposeMatches } from '../lib/columnMap.js'
import { colors, ghostButton, label, mono, panel, sans, tint } from '../theme.js'

const field = (width) => ({
  width,
  background: colors.ground,
  border: `1px solid ${colors.panelEdge}`,
  borderRadius: 6,
  color: colors.ink,
  fontSize: 13,
  padding: '6px 8px',
})

// Column matching for one file (final-spec C1): where the definitions read a
// column this file names differently, the person says which file column stands
// for it — from a dropdown. A proposal (the same name ignoring case, spaces and
// punctuation) is shown with both names and does nothing until it is accepted.
//
// Renders nothing when every column the definitions read is in the file under
// its own name and nothing is matched.
export default function ColumnMatcher({ what, expected, file, map = {}, onChange }) {
  if (!file) return null
  const fileColumns = file.fileColumns ?? file.columns ?? []
  const present = new Set(fileColumns)
  // Every column that needs a decision: matched already, or read by the
  // definitions and not in the file under that name.
  const names = [...new Set([...expected.filter((column) => map[column] || !present.has(column)), ...Object.keys(map)])]
  if (names.length === 0) return null

  const issues = columnMapIssues(map, fileColumns)
  const proposals = new Map(proposeMatches(names, fileColumns, map).map((p) => [p.expected, p.actual]))
  const unmatched = names.filter((column) => !map[column])
  const set = (column, actual) => {
    const next = { ...map }
    if (actual) next[column] = actual
    else delete next[column]
    onChange(next)
  }
  const usedElsewhere = (column) => new Set(Object.entries(map).filter(([expectedName]) => expectedName !== column).map(([, actual]) => actual))

  return (
    <div style={{ ...panel, background: colors.panelSunk, padding: 12, marginTop: 8 }} data-column-matcher={what}>
      <div style={label}>Match columns — {what}</div>
      <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: colors.mute, margin: '4px 0 8px' }}>
        {unmatched.length > 0
          ? `${unmatched.length} column${unmatched.length === 1 ? '' : 's'} the definitions read ${unmatched.length === 1 ? 'is' : 'are'} not in this file under that name. Choose the file’s column for each; one left unmatched is reported as not checked, never guessed.`
          : 'Every column the definitions read is matched to a column of this file.'}
      </p>
      {names.map((column) => {
        const taken = usedElsewhere(column)
        const proposal = proposals.get(column)
        return (
          <div key={column} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontFamily: mono, fontSize: 12, color: colors.ink, minWidth: 150 }}>{column}</span>
            <span aria-hidden="true" style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>is this file’s</span>
            <select
              aria-label={`${what}: file column for ${column}`}
              value={map[column] ?? ''}
              onChange={(e) => set(column, e.target.value)}
              style={{ ...field(210), fontFamily: mono, cursor: 'pointer' }}
            >
              <option value="">(not matched)</option>
              {/* A matched column the file lacks stays listed, so the mismatch is visible. */}
              {map[column] && !present.has(map[column]) && <option value={map[column]}>{map[column]} — not in this file</option>}
              {fileColumns.filter((c) => !taken.has(c)).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {proposal && (
              <button onClick={() => set(column, proposal)} style={{ ...ghostButton, color: colors.accent, borderColor: `${tint(colors.accent, '55')}` }}>
                Use “{proposal}” — the same name apart from case and punctuation
              </button>
            )}
          </div>
        )
      })}
      {issues.length > 0 && (
        <ul role="alert" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {issues.map((issue) => <li key={issue} style={{ fontFamily: sans, fontSize: 13, color: colors.warn, lineHeight: 1.5 }}>{issue} Checks on this file will not run until it is fixed.</li>)}
        </ul>
      )}
    </div>
  )
}
