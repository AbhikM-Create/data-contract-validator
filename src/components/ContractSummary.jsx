import { useState } from 'react'
import { TYPES, describeCadence, formatDate } from '../lib/contract.js'
import { colors, ghostButton, label, mono, panel, sans } from '../theme.js'

const short = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-3)) return value.toExponential(1)
  return value.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 })
}

function expectation(column) {
  if (column.type === TYPES.NUMERIC) return `${short(column.min)} to ${short(column.max)} · median ${short(column.median)}`
  if (column.type === TYPES.DATE) return `${formatDate(column.oldest)} to ${formatDate(column.newest)} · ${describeCadence(column.cadenceMs)}`
  if (column.type === TYPES.CATEGORICAL || column.type === TYPES.BOOLEAN) {
    const shown = column.domain.slice(0, 5).join(', ')
    return column.domain.length > 5 ? `${shown}, +${column.domain.length - 5} more` : shown
  }
  if (column.type === TYPES.EMPTY) return 'no values'
  return 'free text · not range-checked'
}

// Read-only: this shows what the baseline IMPLIES, it is not a contract editor.
export default function ContractSummary({ contract }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ ...panel, padding: '14px 16px', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={label}>Contract inferred from the baseline</span>
        <button onClick={() => setOpen(!open)} style={ghostButton}>{open ? 'hide columns' : `show ${contract.columns.length} columns`}</button>
      </div>

      <div style={{ fontFamily: mono, fontSize: 11.5, color: colors.mute, marginTop: 8 }}>
        {contract.rowCount.toLocaleString('en-US')} rows
        {contract.dateColumn
          ? ` · keyed on ${contract.dateColumn} · updates ${describeCadence(contract.cadenceMs)} · newest ${formatDate(contract.newest)}`
          : ' · no date column, so freshness cannot be judged'}
      </div>

      {open && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: sans, fontSize: 13 }}>
            <thead>
              <tr>
                {['Column', 'Type', 'Baseline shape', 'Blank'].map((heading) => (
                  <th
                    key={heading}
                    style={{ ...label, textAlign: 'left', padding: '6px 10px 6px 0', borderBottom: `1px solid ${colors.panelEdge}`, whiteSpace: 'nowrap' }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contract.columns.map((column) => (
                <tr key={column.name}>
                  <td style={{ fontFamily: mono, fontSize: 12.5, color: colors.accent, padding: '7px 10px 7px 0', borderBottom: `1px solid ${colors.panelEdge}`, whiteSpace: 'nowrap' }}>
                    {column.name}
                  </td>
                  <td style={{ fontFamily: mono, fontSize: 12, color: colors.mute, padding: '7px 10px 7px 0', borderBottom: `1px solid ${colors.panelEdge}` }}>
                    {column.type}
                  </td>
                  <td style={{ color: colors.ink, padding: '7px 10px 7px 0', borderBottom: `1px solid ${colors.panelEdge}` }}>
                    {expectation(column)}
                  </td>
                  <td style={{ fontFamily: mono, fontSize: 12, color: colors.faint, padding: '7px 0', borderBottom: `1px solid ${colors.panelEdge}`, whiteSpace: 'nowrap' }}>
                    {(column.nullRate * 100).toFixed(column.nullRate > 0 && column.nullRate < 0.01 ? 2 : 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
