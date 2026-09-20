import { CHECK_COPY } from '../copy.js'
import { colors, mono, panel, sans, statusColor } from '../theme.js'

export default function LayerCard({ layer, index, isLead }) {
  const tone = statusColor[layer.status] ?? colors.faint

  return (
    <section
      style={{
        ...panel,
        borderColor: isLead ? `${tone}88` : colors.panelEdge,
        padding: '14px 16px',
        marginTop: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>{index + 1}</span>
        <h3 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: 0 }}>{layer.label}</h3>
        <span style={{ fontFamily: sans, fontSize: 13, color: colors.faint, flex: 1, minWidth: 180 }}>
          {CHECK_COPY[layer.id]?.plain ?? layer.question}
        </span>
        <span
          style={{
            marginLeft: 'auto', fontFamily: mono, fontSize: 11, letterSpacing: '0.08em',
            color: tone, border: `1px solid ${tone}66`, borderRadius: 5, padding: '3px 8px',
          }}
        >
          {layer.status}
        </span>
      </div>

      {layer.note && (
        <p style={{ fontFamily: sans, fontSize: 13.5, lineHeight: 1.5, color: colors.mute, marginTop: 10 }}>{layer.note}</p>
      )}

      {layer.status === 'PASS' && (
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, marginTop: 10 }}>
          Nothing wrong here — on this check, the new file matches the one you trust.
        </p>
      )}

      {layer.violations.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {layer.violations.map((violation, i) => (
            <li
              key={`${violation.code}-${violation.column ?? 'table'}-${i}`}
              style={{
                background: colors.panelSunk,
                border: `1px solid ${colors.panelEdge}`,
                borderLeft: `2px solid ${tone}`,
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: tone }}>{violation.code}</span>
                {violation.column && (
                  <span style={{ fontFamily: mono, fontSize: 11, color: colors.accent }}>{violation.column}</span>
                )}
              </div>
              <p style={{ fontFamily: sans, fontSize: 13.5, lineHeight: 1.55, color: colors.ink, marginTop: 6 }}>
                {violation.message}
              </p>
              {violation.evidence && (
                <div style={{ fontFamily: mono, fontSize: 11.5, color: colors.faint, marginTop: 6 }}>{violation.evidence}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
