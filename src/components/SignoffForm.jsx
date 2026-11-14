import { DISPOSITIONS, IDENTITY_FIELDS, OWNER_STEPS, SIGNATORIES, decisionFor, emptySignoff, exceptionsFor, ownersOf } from '../lib/signoff.js'
import { colors, label, mono, panel, sans, tint } from '../theme.js'

// The cutover sign-off record (v3 §5.3), filled in where the checks are. What
// is typed here is saved with the object — names, dates, decisions, reasons —
// and printed in the evidence pack. Nothing here is copied from a file.
//
// The differences listed are those of the CURRENT results only: a stale result
// is not in the pack, so it is not offered for a decision.
export default function SignoffForm({ object, files, readiness, recon, onChange }) {
  // Edited as typed (a trailing space mid-word must survive the keystroke);
  // cleanSignoff runs where the record is saved and printed.
  const raw = object.signoff ?? {}
  const record = { ...emptySignoff(), ...raw, identity: raw.identity ?? {}, custody: raw.custody ?? {}, exceptions: raw.exceptions ?? {}, signatures: raw.signatures ?? {} }
  const owners = ownersOf(object)
  const exceptions = exceptionsFor(readiness && !readiness.stale ? readiness.report : null, recon && !recon.stale ? recon.report : null, owners)
  const roles = Object.keys(files).filter((role) => files[role])
  const decided = exceptions.filter((e) => decisionFor(record, e).disposition).length

  const save = (patch) => onChange({ signoff: { ...record, ...patch } })
  const setIn = (part, key, value) => save({ [part]: { ...record[part], [key]: value } })

  return (
    <div style={{ ...panel, padding: '20px 22px', marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={label}>Sign-off record</div>
        {exceptions.length > 0 && (
          <span style={{ fontFamily: sans, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', borderRadius: 6, padding: '3px 8px', color: decided === exceptions.length ? colors.ink : colors.warn, background: decided === exceptions.length ? 'var(--hairline)' : `${tint(colors.warn, '17')}` }}>
            {decided} of {exceptions.length} decided
          </span>
        )}
      </div>
      <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, margin: '6px 0 0', lineHeight: 1.5, maxWidth: 760 }}>
        What the people who sign need on one record. Printed at the front of the evidence pack and saved with this object.
        It is a record the team signs, not a certificate: names are as typed, not verified identities.
      </p>

      <Group title="Identity">
        <div style={grid}>
          {IDENTITY_FIELDS.map((f) => (
            <Text key={f.id} label={f.label} caption={f.label} value={record.identity[f.id]} onChange={(v) => setIn('identity', f.id, v)} />
          ))}
        </div>
      </Group>

      {roles.length > 0 && (
        <Group title="Chain of custody — who exported each file, and when">
          <div style={grid}>
            {roles.map((role) => (
              <div key={role}>
                <div style={{ fontFamily: mono, fontSize: 12, color: colors.mute, marginBottom: 4 }}>{files[role].name}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Text label={`exported by — ${role}`} placeholder="exported by" value={record.custody[role]?.exportedBy} onChange={(v) => setIn('custody', role, { ...record.custody[role], exportedBy: v })} />
                  <Text label={`exported when — ${role}`} placeholder="date, time" value={record.custody[role]?.exportedAt} onChange={(v) => setIn('custody', role, { ...record.custody[role], exportedAt: v })} />
                </div>
              </div>
            ))}
          </div>
        </Group>
      )}

      <Group title={`Exceptions — ${exceptions.length ? `${exceptions.length} difference${exceptions.length === 1 ? '' : 's'} in the current results` : 'none in the current results'}`}>
        {exceptions.length === 0 && (
          <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, margin: 0 }}>Run the checks; every difference they find appears here for a decision.</p>
        )}
        {exceptions.map((e) => {
          const d = decisionFor(record, e)
          const set = (patch) => setIn('exceptions', e.id, { ...d, ...patch })
          return (
            <div key={e.id} style={{ background: colors.panel, borderRadius: 12, padding: '12px 14px', marginBottom: 8, borderWidth: 1, borderStyle: 'solid', borderColor: d.disposition ? 'var(--card-edge)' : `${tint(colors.warn, '66')}`, boxShadow: 'var(--hairline-shadow)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div style={{ fontFamily: sans, fontSize: 14, color: colors.ink, minWidth: 0 }}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: colors.mute }}>{e.step} · </span>{e.what}
                </div>
                <span style={{ fontFamily: sans, fontSize: 12, fontWeight: 600, color: d.disposition ? colors.mute : colors.warn }}>{d.disposition ? 'Decided' : 'Needs a decision'}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                <select aria-label={`decision — ${e.what}`} value={d.disposition ?? ''} onChange={(ev) => set({ disposition: ev.target.value })} style={{ ...input, width: 230, cursor: 'pointer' }}>
                  <option value="">not yet decided</option>
                  {DISPOSITIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <Text label={`reason — ${e.what}`} placeholder="reason" value={d.reason} onChange={(v) => set({ reason: v })} width={280} />
                <Text label={`owner — ${e.what}`} placeholder={e.owner} value={d.owner} onChange={(v) => set({ owner: v })} width={220} />
              </div>
            </div>
          )
        })}
      </Group>

      <Group title="Scope and limits — what this record does not cover">
        <textarea
          aria-label="scope and limits"
          value={record.scope}
          onChange={(e) => save({ scope: e.target.value })}
          placeholder="e.g. History migrated as balances only; GST returns not re-checked."
          rows={2}
          style={{ ...input, width: '100%', fontFamily: sans, resize: 'vertical' }}
        />
        <p style={{ fontFamily: sans, fontSize: 12, color: colors.faint, margin: '4px 0 0' }}>The pack also lists, by itself, every check that did not run or was not judged.</p>
      </Group>

      <Group title="Signatures">
        <div style={grid}>
          {SIGNATORIES.map((s) => (
            <div key={s.id}>
              <div style={{ fontFamily: sans, fontSize: 12, color: colors.mute, marginBottom: 4 }}>{s.label}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Text label={`${s.label} — name`} placeholder="name" value={record.signatures[s.id]?.name} onChange={(v) => setIn('signatures', s.id, { ...record.signatures[s.id], name: v })} />
                <Text label={`${s.label} — date`} placeholder="date" value={record.signatures[s.id]?.date} onChange={(v) => setIn('signatures', s.id, { ...record.signatures[s.id], date: v })} width={110} />
              </div>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Whose fix each step is">
        <div style={grid}>
          {OWNER_STEPS.map((step) => (
            <Text
              key={step.id}
              label={`owner of ${step.label}`}
              caption={step.label}
              value={object.owners?.[step.id] ?? ''}
              placeholder={owners[step.id]}
              onChange={(v) => onChange({ owners: { ...object.owners, [step.id]: v } })}
            />
          ))}
        </div>
      </Group>
    </div>
  )
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }
const input = {
  // 28px high: wrapped onto its own line, a field must still be a full-size target (WCAG 2.5.8).
  minHeight: 28,
  boxSizing: 'border-box',
  background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6, color: colors.ink,
  fontFamily: sans, fontSize: 13, padding: '6px 8px',
}

function Group({ title, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: colors.ink, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

function Text({ label: name, caption, value, onChange, placeholder, width }) {
  return (
    <label style={{ display: 'block', flex: width ? `0 0 ${width}px` : 1, minWidth: 0 }}>
      {caption && <span style={{ display: 'block', fontFamily: sans, fontSize: 12, color: colors.mute, marginBottom: 4 }}>{caption}</span>}
      <input
        type="text"
        aria-label={name}
        value={value ?? ''}
        placeholder={placeholder ?? name}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...input, width: '100%' }}
      />
    </label>
  )
}
