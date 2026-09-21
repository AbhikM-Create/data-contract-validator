import { useRef } from 'react'
import { colors, mono, primaryButton, sans } from '../theme.js'

// Naming, downloading and loading a contract. A contract that only exists in
// one browser tab is not a contract, so this is what lets it outlive the
// session — and, once there is a database, it is the same spec that gets stored.
export default function ContractFileBar({ name, onName, rules, onLoad, onDownload, notice, onSave, saving, signedIn }) {
  const inputRef = useRef(null)
  const empty = rules.length === 0

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={name}
          aria-label="contract name"
          placeholder="Name this contract"
          onChange={(e) => onName(e.target.value)}
          style={{
            flex: '1 1 220px', minWidth: 180, background: colors.ground,
            border: `1px solid ${colors.panelEdge}`, borderRadius: 6, color: colors.ink,
            fontFamily: sans, fontSize: 13, padding: '8px 10px', outline: 'none',
          }}
        />
        {signedIn && (
          <button
            onClick={onSave}
            disabled={empty || saving}
            title={empty ? 'Write a rule first — there is nothing to save yet.' : undefined}
            style={{
              ...primary,
              opacity: empty || saving ? 0.5 : 1,
              cursor: empty || saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save to account'}
          </button>
        )}
        <button onClick={() => inputRef.current?.click()} style={secondary}>Load a file</button>
        <button
          onClick={onDownload}
          disabled={rules.length === 0}
          title={rules.length === 0 ? 'Write a rule first — there is nothing to save yet.' : undefined}
          style={{ ...secondary, color: rules.length === 0 ? colors.faint : colors.ink, cursor: rules.length === 0 ? 'default' : 'pointer' }}
        >
          Download
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) onLoad(file); e.target.value = '' }}
          style={{ display: 'none' }}
        />
      </div>

      <p style={{ fontFamily: sans, fontSize: 11.5, color: colors.faint, lineHeight: 1.5, marginTop: 8 }}>
        A saved contract holds your rules and nothing else — never the file it was written against. Values you
        typed or promoted into a rule are part of the rule, so they are saved with it.
      </p>

      {notice && (
        <div
          style={{
            marginTop: 10, padding: '9px 11px', borderRadius: 6,
            border: `1px solid ${notice.tone === 'bad' ? colors.fail : notice.tone === 'warn' ? colors.warn : colors.pass}55`,
            background: `${notice.tone === 'bad' ? colors.fail : notice.tone === 'warn' ? colors.warn : colors.pass}10`,
          }}
        >
          <div style={{ fontFamily: sans, fontSize: 12.5, color: notice.tone === 'bad' ? colors.fail : notice.tone === 'warn' ? colors.warn : colors.pass, lineHeight: 1.5 }}>
            {notice.text}
          </div>
          {notice.details?.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
              {notice.details.map((detail) => (
                <li key={detail} style={{ fontFamily: mono, fontSize: 11, color: colors.faint, lineHeight: 1.6 }}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

const primary = {
  ...primaryButton,
  fontSize: 13,
  padding: '8px 13px',
}

const secondary = {
  background: 'transparent',
  border: `1px solid ${colors.panelEdge}`,
  color: colors.ink,
  borderRadius: 6,
  padding: '8px 12px',
  fontFamily: sans,
  fontSize: 13,
  cursor: 'pointer',
}
