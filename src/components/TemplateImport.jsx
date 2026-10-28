import { useState } from 'react'
import { parseCsv } from '../lib/parseCsv.js'
import { ruleKey } from '../lib/rules.js'
import { cockpitProposals, fieldListProposals, isSpreadsheetXml, readMigrationCockpitTemplate } from '../lib/templates.js'
import { colors, ghostButton, label, mono, panel, sans, secondaryButton } from '../theme.js'

// Rules from the target's own load template: what it requires and accepts,
// as the target system publishes it. Read in this page; each proposal shows
// the line of the template it came from, and is added only when accepted.
export default function TemplateImport({ rules, onAdd }) {
  const [source, setSource] = useState(null) // { name, kind: 'cockpit'|'fields', structures?, result? }
  const [sheet, setSheet] = useState(0)
  const [naming, setNaming] = useState('technical')
  const [problem, setProblem] = useState(null)

  const open = async (file) => {
    if (!file) return
    setProblem(null)
    const text = await file.text()
    if (isSpreadsheetXml(text)) {
      const read = readMigrationCockpitTemplate(text)
      if (read.error) { setSource(null); setProblem(`${file.name}: ${read.error}.`); return }
      setSource({ name: file.name, kind: 'cockpit', structures: read.structures })
      setSheet(0)
      return
    }
    const csv = parseCsv(text)
    if (csv.error) { setSource(null); setProblem(`${file.name}: ${csv.error}`); return }
    const result = fieldListProposals(csv.rows, csv.columns)
    if (result.error) { setSource(null); setProblem(`${file.name}: ${result.error}.`); return }
    setSource({ name: file.name, kind: 'fields', result })
  }

  const result = source?.kind === 'cockpit' ? cockpitProposals(source.structures[sheet], { naming }) : source?.result
  const have = new Set(rules.map(ruleKey))
  const pending = (result?.proposals ?? []).filter((p) => !have.has(ruleKey(p.rule)))

  return (
    <div>
      <label style={{ ...secondaryButton, display: 'inline-block' }}>
        Read a template (.xml or .csv)
        <input type="file" accept=".xml,.csv,text/xml,text/csv" onChange={(e) => { open(e.target.files?.[0]); e.target.value = '' }} style={{ display: 'none' }} />
      </label>
      <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 8, maxWidth: 680, lineHeight: 1.5 }}>
        An SAP S/4HANA Migration Cockpit file template (the .xml it downloads), or a field list as CSV with columns such as
        Field name, Required, Type, Allowed values (separated by ; or |), Min and Max — a Workday or Salesforce template saved as CSV works.
      </p>
      {problem && <p style={{ fontFamily: sans, fontSize: 13, color: colors.fail, marginTop: 8 }}>{problem}</p>}

      {source && result && (
        <div style={{ ...panel, padding: 14, marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: colors.ink }}>{source.name}</span>
            {source.kind === 'cockpit' && (
              <>
                {source.structures.length > 1 && (
                  <select aria-label="Sheet" value={sheet} onChange={(e) => setSheet(Number(e.target.value))} style={field}>
                    {source.structures.map((s, i) => <option key={s.sheet} value={i}>{s.sheet}{s.structure ? ` (${s.structure})` : ''}</option>)}
                  </select>
                )}
                <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>Load file columns are named by</span>
                {[['technical', 'technical name'], ['description', 'description']].map(([id, text]) => (
                  <label key={id} style={{ fontFamily: sans, fontSize: 12.5, color: colors.ink, display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="radio" name="template-naming" checked={naming === id} onChange={() => setNaming(id)} />{text}
                  </label>
                ))}
              </>
            )}
            {pending.length > 1 && (
              <button onClick={() => pending.forEach((p) => onAdd(p.rule))} style={{ ...ghostButton, color: colors.accent, borderColor: `${colors.accent}55`, marginLeft: 'auto' }}>
                Add all {pending.length}
              </button>
            )}
          </div>

          <div style={{ ...label, marginTop: 12 }}>Proposed rules — hover for where each came from</div>
          {pending.length === 0 ? (
            <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>
              {result.proposals.length ? 'All proposed rules are already in the contract.' : 'Nothing in this template can be checked exactly.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {pending.map((p) => (
                <button key={ruleKey(p.rule)} onClick={() => onAdd(p.rule)} title={p.evidence} style={{ ...ghostButton, color: colors.ink }}>
                  + <span style={{ fontFamily: mono }}>{p.rule.column}</span> — {p.label}
                </button>
              ))}
            </div>
          )}

          {result.notImported.length > 0 && (
            <>
              <div style={{ ...label, marginTop: 14 }}>Not imported — check these another way</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.notImported.map((n, i) => (
                  <li key={i} style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>
                    <span style={{ fontFamily: mono }}>{n.column}</span>: {n.what} — {n.reason}.
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const field = { background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6, color: colors.ink, fontFamily: sans, fontSize: 13, padding: '6px 9px' }
