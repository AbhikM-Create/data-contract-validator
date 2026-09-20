import { useState } from 'react'
import ContractFileBar from '../components/ContractFileBar.jsx'
import RuleEditor from '../components/RuleEditor.jsx'
import UploadCard from '../components/UploadCard.jsx'
import { describeRule, ruleKey, ruleLayer } from '../lib/rules.js'
import { LAYERS } from '../lib/validate.js'
import { go } from '../routes.js'
import { colors, ghostButton, label, mono, panel, sans, secondaryButton } from '../theme.js'
import { ScreenHead, Section } from './ValidateScreen.jsx'

// Facets are the app's own layers, and only the ones a rule can actually land
// in. There is no authorable freshness rule in the v2 set, so there is no
// Freshness facet — an always-empty tab is a promise the app does not keep.
const FACETS = [
  { id: 'all', label: 'All rules' },
  ...LAYERS.filter((layer) => layer.id !== 'freshness').map((layer) => ({
    id: layer.id,
    label: layer.id === 'semantics' ? 'Value-set rules' : `${layer.label} rules`,
  })),
]

export default function ContractsScreen({
  contract, draft, baseline, rules, contractName, contractNotice,
  onName, onLoadContract, onDownloadContract, onLoadBaseline, onClearBaseline,
  onAddRule, onRemoveRule, onClearRules,
}) {
  const [facet, setFacet] = useState('all')
  const [query, setQuery] = useState('')

  const counts = rules.reduce((acc, rule) => {
    const id = ruleLayer(rule)
    acc[id] = (acc[id] ?? 0) + 1
    return acc
  }, {})

  const visible = rules
    .filter((rule) => facet === 'all' || ruleLayer(rule) === facet)
    .filter((rule) => {
      const text = query.trim().toLowerCase()
      return !text || describeRule(rule).toLowerCase().includes(text)
    })

  const columns = draft?.columnNames ?? []

  return (
    <>
      <ScreenHead
        title="Contracts"
        blurb="A contract is the set of rules a file must obey — which values are legal, which dates must follow which. Written once, checked against every file that arrives."
        action={rules.length > 0 ? <button onClick={() => go('validate')} style={secondaryButton}>Use in a validation →</button> : null}
      />

      <div style={{ ...panel, padding: '16px 18px', marginTop: 20 }}>
        <span style={label}>Contract</span>
        <ContractFileBar
          name={contractName}
          onName={onName}
          rules={rules}
          onLoad={onLoadContract}
          onDownload={onDownloadContract}
          notice={contractNotice}
        />
      </div>

      <div className="contracts-layout" style={{ marginTop: 24 }}>
        <nav className="contracts-facets" style={{ ...panel, padding: 8, position: 'sticky', top: 116 }}>
          {FACETS.map((item) => {
            const active = item.id === facet
            const count = item.id === 'all' ? rules.length : (counts[item.id] ?? 0)
            return (
              <button
                key={item.id}
                onClick={() => setFacet(item.id)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                  background: active ? colors.panelSunk : 'transparent',
                  border: 'none', borderLeft: `2px solid ${active ? colors.accent : 'transparent'}`,
                  color: active ? colors.ink : colors.mute,
                  fontFamily: sans, fontSize: 13, fontWeight: active ? 600 : 500,
                  padding: '9px 10px', borderRadius: 5, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span>{item.label}</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>{count}</span>
              </button>
            )
          })}
        </nav>

        <div>
          {rules.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={query}
                aria-label="search rules"
                placeholder="Search rules…"
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  flex: '1 1 220px', background: colors.panel, border: `1px solid ${colors.panelEdge}`,
                  borderRadius: 6, color: colors.ink, fontFamily: sans, fontSize: 13, padding: '8px 11px', outline: 'none',
                }}
              />
              <span style={{ fontFamily: sans, fontSize: 12, color: colors.faint }}>
                {visible.length} of {rules.length} shown
              </span>
              <button onClick={onClearRules} style={ghostButton}>remove all</button>
            </div>
          )}

          {rules.length === 0 ? (
            <div style={{ ...panel, padding: '22px 20px' }}>
              <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>No rules yet</div>
              <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.55, marginTop: 7, maxWidth: 560 }}>
                Load a contract you saved earlier, or read a baseline CSV below — its columns and the values it
                contains become suggestions you can promote into rules.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint }}>
              No rules match. Clear the search or pick another group.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {visible.map((rule) => (
                <li
                  key={ruleKey(rule)}
                  style={{
                    ...panel, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '11px 13px', marginBottom: 7,
                  }}
                >
                  <span style={{ fontFamily: sans, fontSize: 13.5, color: colors.ink, flex: 1, minWidth: 240 }}>
                    {describeRule(rule)}
                  </span>
                  {/* a category, not a verdict — status styling here would
                      spend pass/fail colour on something that has neither */}
                  <span
                    style={{
                      fontFamily: sans, fontSize: 11, color: colors.mute,
                      background: colors.panelSunk, border: `1px solid ${colors.panelEdge}`,
                      borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap',
                    }}
                  >
                    {facetLabel(ruleLayer(rule))}
                  </span>
                  <button onClick={() => onRemoveRule(rule)} style={ghostButton}>remove</button>
                </li>
              ))}
            </ul>
          )}

          {/* The baseline comes before the editor because the editor depends on
              it: rules are written against column names, and there are none
              until a file has been read. */}
          <Section
            title={columns.length === 0 ? 'Start from a baseline' : 'Drafting from'}
            blurb={columns.length === 0
              ? 'Rules are written against column names, so read one CSV to learn them. It is read in this browser and saved nowhere.'
              : 'These column names and the values they held are what the suggestions below are drawn from.'}
          >
            <div style={{ maxWidth: 440 }}>
              <UploadCard
                step={1}
                title="Baseline CSV"
                tag="draft source"
                hint="Only its shape is used — to offer suggestions and fill the column dropdowns."
                accent={colors.accent}
                file={baseline}
                onFile={onLoadBaseline}
                onClear={onClearBaseline}
              />
            </div>
          </Section>

          <Section
            title="Add a rule"
            blurb={columns.length === 0
              ? 'Available once a baseline has been read.'
              : 'Write one from the dropdowns, or promote something the baseline already showed.'}
          >
            <RuleEditor contract={contract} rules={rules} columns={columns} onAdd={onAddRule} />
          </Section>
        </div>
      </div>
    </>
  )
}

function facetLabel(layerId) {
  const facet = FACETS.find((item) => item.id === layerId)
  return facet ? facet.label.replace(' rules', '') : layerId
}
