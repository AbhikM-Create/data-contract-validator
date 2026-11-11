import { useState } from 'react'
import { packLabel, packParams, paramIssues } from '../lib/packs.js'
import { findPack, PACKS } from '../packs/index.js'
import { colors, ghostButton, label, mono, panel, sans } from '../theme.js'
import ConfirmButton from './ConfirmButton.jsx'

// Start a migration object from a pack (v3-spec §6): a choice of pack object,
// and the same ask-first as "New" when work would be replaced. An object that
// needs a value only the client knows (the cutover date) asks for it first.
export default function PackPicker({ needsConfirm, onStart }) {
  const [choice, setChoice] = useState('')
  const [values, setValues] = useState({})
  const [packId, objectId] = choice.split('/')
  const pack = packId ? findPack(packId) : null
  const object = pack?.objects.find((o) => o.id === objectId)
  const params = object ? packParams(pack, objectId) : []
  const missing = object ? paramIssues(pack, objectId, values) : []
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
      <span style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute }}>Or start from a pack</span>
      <select
        aria-label="pack object to start from"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        style={{ background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6, color: colors.ink, fontFamily: sans, fontSize: 12.5, padding: '6px 8px', cursor: 'pointer', maxWidth: 360 }}
      >
        <option value="">choose a pack object</option>
        {PACKS.map((p) => (
          <optgroup key={p.id} label={`${p.name} — v${p.version}${p.status === 'verified' ? '' : ' (draft)'}`}>
            {p.objects.map((o) => <option key={o.id} value={`${p.id}/${o.id}`}>{o.name}</option>)}
          </optgroup>
        ))}
      </select>
      {params.map((param) => (
        <label key={param.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontFamily: sans, fontSize: 12.5, color: colors.ink }}>
          {param.label}
          <input
            type="date"
            value={values[param.id] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [param.id]: e.target.value }))}
            style={{ background: colors.ground, border: `1px solid ${colors.panelEdge}`, borderRadius: 6, color: colors.ink, fontFamily: mono, fontSize: 12, padding: '5px 6px' }}
          />
        </label>
      ))}
      {object && missing.length === 0 && (
        <ConfirmButton
          needsConfirm={needsConfirm}
          question={`Replace the object on screen with “${object.name}” from the pack?`}
          confirmLabel="Start from the pack"
          onConfirm={() => onStart(packId, objectId, values)}
        >
          Start “{object.name}”
        </ConfirmButton>
      )}
    </div>
  )
}

// What a pack object asks of the person: which exports to take, what the load
// file is, how to compare — and, while the pack is a draft, what to confirm.
export function PackGuide({ packRef }) {
  const pack = findPack(packRef.id)
  const object = pack?.objects.find((o) => o.id === packRef.object)
  if (!pack || !object) {
    return <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.warn, marginTop: 10 }}>Built from {packLabel(packRef)}, which this version does not ship.</p>
  }
  return (
    <div style={{ ...panel, background: colors.panelSunk, padding: 12, marginTop: 12 }}>
      <div style={label}>From {pack.name} · v{pack.version}</div>
      {pack.status !== 'verified' && (
        <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.warn, margin: '6px 0 0' }}>
          DRAFT — this pack has not yet run on real exports. Check the columns below against your files before relying on a result.
        </p>
      )}
      <dl style={{ fontFamily: sans, fontSize: 12.5, color: colors.ink, margin: '8px 0 0', lineHeight: 1.55 }}>
        <dt style={{ fontWeight: 600 }}>Export</dt><dd style={{ margin: '0 0 6px' }}>{object.guide?.export}</dd>
        <dt style={{ fontWeight: 600 }}>Load file</dt><dd style={{ margin: '0 0 6px' }}>{object.guide?.load}</dd>
        <dt style={{ fontWeight: 600 }}>Compare</dt><dd style={{ margin: '0 0 6px' }}>{object.guide?.compare}</dd>
        {['load', 'source', 'target'].filter((role) => object.columns?.[role]?.length).map((role) => (
          <div key={role}>
            <dt style={{ fontWeight: 600 }}>Columns expected — {role === 'load' ? 'load file' : `${role} extract`}</dt>
            <dd style={{ margin: '0 0 6px', fontFamily: mono, fontSize: 11.5 }}>{object.columns[role].join(' · ')}</dd>
          </div>
        ))}
      </dl>
      {pack.status !== 'verified' && pack.toConfirm?.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ ...ghostButton, display: 'inline-block', cursor: 'pointer' }}>To confirm before relying on it ({pack.toConfirm.length})</summary>
          <ul style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, margin: '6px 0 0', paddingLeft: 18 }}>
            {pack.toConfirm.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
