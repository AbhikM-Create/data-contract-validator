import Staircase from '../components/Staircase.jsx'
import { LAYERS } from '../lib/validate.js'
import { CHECK_COPY, HOW_IT_WORKS } from '../copy.js'
import { MIGRATION_EXAMPLES } from '../samples/migrationExamples.js'
import { SAMPLE_PAIRS } from '../samples/samples.js'
import { go } from '../routes.js'
import { colors, mono, panel, primaryButton, sans, secondaryButton } from '../theme.js'

// The first look. A visitor can read what the tool does and run a ready-made
// example without an account — the checks all happen in their browser, so there
// is nothing to gate behind a sign-up.
//
// It leads with the job most people arrive for: a cutover — checking a load
// file before the load and proving the load after it (final-spec §4.1). The
// drift check, for a feed after go-live, follows as its own section.
// The same Staircase the report uses, filled with a worked example rather than
// a mock-up: showing the app's one distinctive view on the way in beats
// describing it. Labelled as an example so nobody reads it as their own result.
const EXAMPLE_LAYERS = LAYERS.map((layer) => ({
  ...layer,
  status: layer.id === 'distribution' ? 'FAIL' : 'PASS',
  violations: layer.id === 'distribution' ? [{ code: 'central-shift' }, { code: 'out-of-range' }] : [],
}))

export default function LandingScreen({ onLoadSample, onMigrationExample }) {
  return (
    <>
      <section style={{ paddingTop: 14, maxWidth: 760 }}>
        <h1 style={{ fontFamily: sans, fontSize: 34, fontWeight: 660, letterSpacing: '-0.025em', color: colors.ink, margin: 0, lineHeight: 1.15 }}>
          Prove every load before anyone signs it off.
        </h1>
        <p style={{ fontFamily: sans, fontSize: 16, color: colors.mute, lineHeight: 1.6, marginTop: 16 }}>
          Before a load: will the new system accept this file? After it: did every record and balance arrive, correctly?
          The step that catches a problem says what kind of problem it is, and whose fix it is. Your files are read in
          this browser and never sent anywhere.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <button onClick={() => go('migrations')} style={primaryButton}>Start a cutover</button>
          <button onClick={() => go('validate')} style={secondaryButton}>Monitor a feed</button>
        </div>
      </section>

      <section style={{ marginTop: 34 }}>
        <h2 style={{ fontFamily: sans, fontSize: 18, fontWeight: 620, color: colors.ink, margin: 0 }}>
          See a cutover checked — no account needed
        </h2>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 680 }}>
          Each example opens with its files, rules and mapping in place. Every company, person and amount in them is invented.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 16 }}>
          {MIGRATION_EXAMPLES.map((example) => (
            <div key={example.id} style={{ ...panel, padding: '15px 16px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>{example.name}</div>
              <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 4 }}>{example.path}</div>
              <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: colors.mute, marginTop: 9, flex: 1 }}>{example.blurb}</p>
              <button onClick={() => onMigrationExample(example.id)} style={{ ...secondaryButton, marginTop: 14 }} aria-label={`Open the example: ${example.name}`}>
                Open this example
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 52, paddingTop: 30, borderTop: `1px solid ${colors.panelEdge}`, maxWidth: 720 }}>
        <h2 style={{ fontFamily: sans, fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', color: colors.ink, margin: 0, lineHeight: 1.2 }}>
          After go-live: the columns match. That does not make it the same data.
        </h2>
        <p style={{ fontFamily: sans, fontSize: 16, color: colors.mute, lineHeight: 1.6, marginTop: 16 }}>
          A file can keep every column name, every type and every category, and still be wrong — values 83&times;
          what they were, a feed that stopped updating, a grade nobody has ever heard of. This checks a new CSV
          four ways and tells you which check caught it.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <button onClick={() => go('validate')} style={primaryButton}>Validate a file</button>
          <button onClick={() => go('contracts')} style={secondaryButton}>Write a contract</button>
        </div>
      </section>

      <section style={{ marginTop: 34 }}>
        <Staircase
          layers={EXAMPLE_LAYERS}
          title="What the report tells you"
          note="An example — salaries arriving 83× too large"
        />
      </section>

      <section style={{ marginTop: 44 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18 }}>
          {HOW_IT_WORKS.map((step, index) => (
            <div key={step.title} style={{ display: 'flex', gap: 11 }}>
              <span style={{ fontFamily: mono, fontSize: 12, color: colors.accent, paddingTop: 2 }}>{index + 1}</span>
              <div>
                <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: colors.ink }}>{step.title}</div>
                <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.5, marginTop: 4 }}>{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 44 }}>
        <h2 style={{ fontFamily: sans, fontSize: 18, fontWeight: 620, color: colors.ink, margin: 0 }}>
          Try it now — no account needed
        </h2>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 660 }}>
          Each example is a pair of files. They load straight into the validator so you can see a real report
          before using your own data.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 16 }}>
          {SAMPLE_PAIRS.map((sample) => (
            <div key={sample.id} style={{ ...panel, padding: '15px 16px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>{sample.name}</div>
              <div style={{ fontFamily: sans, fontSize: 12, color: colors.faint, marginTop: 4 }}>{sample.expectation}</div>
              <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: colors.mute, marginTop: 9, flex: 1 }}>{sample.blurb}</p>
              <button onClick={() => onLoadSample(sample)} style={{ ...secondaryButton, marginTop: 14 }}>
                Run this example
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 44 }}>
        <h2 style={{ fontFamily: sans, fontSize: 18, fontWeight: 620, color: colors.ink, margin: 0 }}>
          The four checks, in order
        </h2>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 680 }}>
          A file can pass the first three and still fail the last. Knowing <em>which</em> one caught a problem
          tells you what kind of problem it is.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(232px, 1fr))', gap: 12, marginTop: 16 }}>
          {LAYERS.map((layer, index) => (
            <div key={layer.id} style={{ ...panel, padding: '14px 15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: colors.faint }}>{index + 1}</span>
                <span style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>{layer.label}</span>
              </div>
              <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.45, marginTop: 8 }}>
                {CHECK_COPY[layer.id].plain}
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
                {CHECK_COPY[layer.id].catches.map((item) => (
                  <li key={item} style={{ fontFamily: sans, fontSize: 12.5, color: colors.faint, lineHeight: 1.5, display: 'flex', gap: 7 }}>
                    <span style={{ color: colors.accent }}>&middot;</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
