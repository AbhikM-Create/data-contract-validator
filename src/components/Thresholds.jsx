import { useState } from 'react'
import { DEFAULT_THRESHOLDS, LAYERS, THRESHOLD_FIELDS } from '../lib/validate.js'
import { colors, ghostButton, label, mono, panel, sans } from '../theme.js'

const layerLabel = (id) => LAYERS.find((layer) => layer.id === id)?.label ?? id
const shownValue = (values, field) => +(values[field.key] * field.scale).toFixed(4)

// The lines every check is measured against. They stay visible as chips —
// a verdict means nothing without them — but the nine editable inputs sit
// behind one click, so a first-time reader meets the result, not the controls.
export default function Thresholds({ values, onChange, onReset }) {
  const [open, setOpen] = useState(false)
  const isDefault = THRESHOLD_FIELDS.every((field) => values[field.key] === DEFAULT_THRESHOLDS[field.key])

  return (
    <div style={{ ...panel, padding: '14px 16px', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <span style={label}>Sensitivity</span>
          <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, marginTop: 5 }}>
            {isDefault ? 'Using the default limits below.' : 'Using your adjusted limits below.'} A check only complains once a difference passes its limit.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {!isDefault && <button onClick={onReset} style={ghostButton}>reset</button>}
          <button onClick={() => setOpen(!open)} style={{ ...ghostButton, color: colors.ink }}>
            {open ? 'done adjusting' : 'adjust limits'}
          </button>
        </div>
      </div>

      {!open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
          {THRESHOLD_FIELDS.map((field) => {
            const changed = values[field.key] !== DEFAULT_THRESHOLDS[field.key]
            return (
              <span
                key={field.key}
                title={field.help}
                style={{
                  fontFamily: mono, fontSize: 11, color: changed ? colors.accent : colors.mute,
                  border: `1px solid ${changed ? colors.accent : colors.panelEdge}`,
                  borderRadius: 5, padding: '4px 8px', background: colors.panelSunk,
                }}
              >
                {field.label} {shownValue(values, field)}{field.unit}
              </span>
            )
          })}
        </div>
      )}

      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))', gap: 10, marginTop: 12 }}>
          {THRESHOLD_FIELDS.map((field) => {
            const changed = values[field.key] !== DEFAULT_THRESHOLDS[field.key]
            return (
              <div key={field.key} style={{ background: colors.panelSunk, border: `1px solid ${colors.panelEdge}`, borderRadius: 6, padding: '10px 11px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.ink }}>{field.label}</span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: colors.faint }}>{layerLabel(field.layer)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <input
                    type="number"
                    value={shownValue(values, field)}
                    step={field.step}
                    min={field.min}
                    max={field.max}
                    aria-label={`${field.label} threshold`}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (!Number.isFinite(next)) return
                      onChange(field.key, next / field.scale)
                    }}
                    style={{
                      width: 78, background: colors.ground, borderRadius: 5, padding: '5px 7px',
                      border: `1px solid ${changed ? colors.accent : colors.panelEdge}`,
                      color: changed ? colors.accent : colors.ink, fontFamily: mono, fontSize: 13, outline: 'none',
                    }}
                  />
                  <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>{field.unit}</span>
                </div>
                <p style={{ fontFamily: sans, fontSize: 11.5, lineHeight: 1.4, color: colors.faint, marginTop: 8 }}>{field.help}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
