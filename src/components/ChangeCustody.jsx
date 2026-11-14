import { CUSTODY_FIELDS, PARTIES } from '../lib/changeCustody.js'
import { colors, panel, sans } from '../theme.js'

// Who did what, as the person preparing the record types it. Unverified, and
// said to be: the record states custody, it does not prove identity.

export default function ChangeCustody({ custody, selfChecked, missing, onChange }) {
  const set = (id, patch) => onChange({ ...custody, [id]: { ...(custody[id] ?? {}), ...patch } })
  return (
    <div style={{ ...panel, padding: 18, marginTop: 12 }}>
      <label style={{ ...text, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, color: colors.ink }}>Who made the change</span>
        <input value={custody.mover ?? ''} onChange={(e) => onChange({ ...custody, mover: e.target.value })} placeholder="the payroll bureau, the AI run, the vendor" maxLength={120} style={{ ...control, width: 320 }} />
      </label>

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {CUSTODY_FIELDS.map((field) => {
          const line = custody[field.id] ?? {}
          return (
            <div key={field.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ ...text, minWidth: 190 }}>{field.label}</span>
              <select aria-label={field.label} value={line.by ?? ''} onChange={(e) => set(field.id, { by: e.target.value })} style={{ ...control, cursor: 'pointer' }}>
                <option value="">not stated</option>
                {PARTIES.filter((p) => field.parties.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input aria-label={`${field.label} — name`} value={line.name ?? ''} onChange={(e) => set(field.id, { name: e.target.value })} placeholder="name (optional)" maxLength={120} style={{ ...control, width: 180 }} />
              {field.when && <input type="date" aria-label={`${field.label} — date`} value={line.at ?? ''} onChange={(e) => set(field.id, { at: e.target.value })} style={control} />}
            </div>
          )
        })}
      </div>

      {selfChecked.length > 0 && (
        <div role="status" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 6, border: `2px solid ${colors.warn}` }}>
          <p style={{ ...text, margin: 0 }}><strong style={{ color: colors.warn }}>Self-checked.</strong> Part of this check came from whoever made the change, so it is not independent of it. The record will say so on its first page.</p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{selfChecked.map((s) => <li key={s} style={text}>{s}</li>)}</ul>
        </div>
      )}
      {missing.length > 0 && (
        <p style={{ ...text, margin: '12px 0 0' }}>The record will be a draft until it states {missing.join(', ')}.</p>
      )}
      <p style={{ ...text, fontSize: 12, color: colors.faint, margin: '10px 0 0' }}>As typed here; the record says these are not verified identities.</p>
    </div>
  )
}

const text = { fontFamily: sans, fontSize: 13, color: colors.mute }
const control = {
  background: colors.ground,
  border: `1px solid ${colors.control}`,
  borderRadius: 6,
  color: colors.ink,
  fontFamily: sans,
  fontSize: 13,
  padding: '7px 9px',
}
