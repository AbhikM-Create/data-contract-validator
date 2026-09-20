import { useState } from 'react'
import { ruleKey } from '../lib/rules.js'
import { openSuggestions } from '../lib/suggestions.js'
import { colors, label, mono, sans } from '../theme.js'
import RuleBuilder from './RuleBuilder.jsx'

// The controls for adding a rule: write one from dropdowns, or promote a fact
// the baseline already showed. Shared by the pre-check view and the report, so
// rules can be adjusted while looking at what they caught.
function groupByColumn(suggestions) {
  const groups = new Map()
  for (const suggestion of suggestions) {
    const column = suggestion.rule.column
    groups.set(column, [...(groups.get(column) ?? []), suggestion])
  }
  return [...groups.entries()]
}

export default function RuleEditor({ contract, rules, columns: given, onAdd }) {
  const [building, setBuilding] = useState(false)
  const suggestions = openSuggestions(contract, rules)
  // Without a file there are no column names to choose from, and a dropdown of
  // nothing is worse than an explanation.
  const columns = given?.length ? given : (contract?.columnNames ?? [])

  if (columns.length === 0) {
    return (
      <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 12 }}>
        Load a CSV above and the column names appear here, ready to write rules against.
      </p>
    )
  }

  return (
    <div>
      {building ? (
        <div style={{ marginTop: 12 }}>
          <RuleBuilder columns={columns} onAdd={(rule) => { onAdd(rule); setBuilding(false) }} onCancel={() => setBuilding(false)} />
        </div>
      ) : (
        <button
          onClick={() => setBuilding(true)}
          style={{
            marginTop: 12, background: 'transparent', border: `1px solid ${colors.accent}`, color: colors.accent,
            borderRadius: 7, padding: '9px 14px', fontFamily: sans, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          + Write a rule
        </button>
      )}

      {suggestions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span style={label}>From the baseline — promote to a rule</span>
          <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 5 }}>
            Each one is a fact observed in the baseline. Promote the ones that are actually requirements —
            hover to see the evidence behind it.
          </p>
          {/* One row per column, so a reader scans down the columns they know
              rather than across a ragged wrap of differently-sized chips. */}
          <div style={{ marginTop: 12, border: `1px solid ${colors.panelEdge}`, borderRadius: 7, overflow: 'hidden' }}>
            {groupByColumn(suggestions).map(([column, items], index) => (
              <div
                key={column}
                style={{
                  display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap',
                  padding: '9px 12px',
                  borderTop: index === 0 ? 'none' : `1px solid ${colors.panelEdge}`,
                  background: index % 2 === 0 ? colors.panel : colors.panelSunk,
                }}
              >
                <span style={{ fontFamily: mono, fontSize: 11.5, color: colors.accent, minWidth: 128 }}>{column}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                  {items.map((suggestion) => (
                    <button
                      key={ruleKey(suggestion.rule)}
                      onClick={() => onAdd(suggestion.rule)}
                      title={suggestion.evidence}
                      style={{
                        background: colors.panel, border: `1px solid ${colors.panelEdge}`,
                        borderRadius: 5, padding: '4px 9px', cursor: 'pointer',
                        fontFamily: sans, fontSize: 12.5, color: colors.ink,
                      }}
                    >
                      + {suggestion.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
