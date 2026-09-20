import { colors, panel, sans } from '../theme.js'
import { ScreenHead } from './ValidateScreen.jsx'

// A placeholder that says plainly what it is. It shows no tiles, no empty
// table and no sample numbers: a dashboard drawn with fake data reads as a
// working feature, and the first person to click it learns the app lies.
export default function HistoryScreen() {
  return (
    <>
      <ScreenHead
        title="History"
        blurb="Every validation you run will be recorded here — when it ran, which contract it used, which file it checked, and how each layer came out."
      />

      <div style={{ ...panel, padding: '26px 22px', marginTop: 22, maxWidth: 620 }}>
        <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, color: colors.ink }}>
          Not built yet
        </div>
        <p style={{ fontFamily: sans, fontSize: 13.5, color: colors.mute, lineHeight: 1.6, marginTop: 8 }}>
          Saving a run needs an account to save it to, so this screen arrives with sign-in. Until then nothing
          is recorded — each validation lives only as long as the page is open.
        </p>
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.faint, lineHeight: 1.6, marginTop: 12 }}>
          When it lands it will hold your own runs only: a list you can filter by contract, and counts across
          them — how many passed, and which layer fails most often. It reads records you created by running
          validations here; it does not connect to, schedule against, or watch any data source.
        </p>
      </div>
    </>
  )
}
