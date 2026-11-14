// The Plumbstep palette, read by every component. Direction C — Isometric
// (approved 14 Nov 2026): a cool gradient ground (index.css), white cards that
// float on it with real depth, deep slate text, and one teal — the plumb line
// of the logo — for every action. The signature is the isometric staircase
// (Staircase.jsx). Green and red appear ONLY on a verdict; if they decorated
// anything else they would stop meaning pass and fail.

export const colors = {
  ground: '#F4F6F8',
  panel: '#FFFFFF',
  panelSunk: '#EFF3F5',
  panelEdge: '#DCE3E8',
  ink: '#16222B',
  mute: '#4E5D68',
  // faint and pass were darkened in v3 F8 to reach WCAG AA 4.5:1 on every
  // ground they sit on (the lightest was 3.2:1); the hues are unchanged.
  faint: '#5F6C76',
  accent: '#1F6F8B',
  // Verdicts, tightened in the brand: each 5.9–6.5:1 on white.
  pass: '#1B7347',
  fail: '#B3261E',
  warn: '#8A5300',
  // The edge of a control a person must find: inputs, dropdowns (3.4:1 on
  // white, the WCAG 1.4.11 minimum being 3:1). panelEdge stays decorative.
  control: '#868C93',
}

// Depth: a card floats on the ground. One elevation for every card, a deeper
// one for what sits above the page (the bar, a hero card).
export const elevation = {
  card: '0 1px 2px rgba(22,34,43,0.05), 0 14px 32px -16px rgba(22,34,43,0.20)',
  raised: '0 2px 4px rgba(22,34,43,0.06), 0 22px 48px -18px rgba(22,34,43,0.26)',
}

export const statusColor = {
  PASS: colors.pass,
  FAIL: colors.fail,
  SKIPPED: colors.faint,
  INSUFFICIENT: colors.warn,
  UNCHECKED: colors.warn,
  'NOT RUN': colors.faint,
  'NOT SET': colors.faint,
}

// Geist for words, Geist Mono for data — shipped with the app (src/fonts/,
// SIL OFL), since the security policy allows fonts from this origin only.
export const mono = "'Geist Mono', ui-monospace, 'SF Mono', Consolas, Menlo, monospace"
export const sans = "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

// Border set as longhands, not the `border` shorthand: components tint one
// side (a status stripe), and mixing shorthand with longhand makes React drop
// one of them when the value changes between renders.
export const panel = {
  background: colors.panel,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(220,227,232,0.75)',
  borderRadius: 16,
  boxShadow: elevation.card,
}

export const label = {
  fontFamily: sans,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.07em',
  color: colors.faint,
  textTransform: 'uppercase',
}

// All three use border LONGHANDS, like `panel` above. Callers tint one edge —
// a destructive action's border goes red — and setting the `border` shorthand
// alongside a longhand makes React drop one of them on re-render.
export const ghostButton = {
  background: 'transparent',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: colors.panelEdge,
  color: colors.mute,
  fontFamily: sans,
  fontSize: 13,
  fontWeight: 500,
  padding: '7px 12px',
  borderRadius: 9,
  cursor: 'pointer',
}

export const primaryButton = {
  background: colors.accent,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  color: '#FFFFFF',
  fontFamily: sans,
  fontSize: 15,
  fontWeight: 600,
  padding: '12px 20px',
  borderRadius: 12,
  minHeight: 46,
  boxShadow: '0 8px 18px -10px rgba(31,111,139,0.75)',
  cursor: 'pointer',
}

export const secondaryButton = {
  background: colors.panel,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: colors.panelEdge,
  color: colors.ink,
  fontFamily: sans,
  fontSize: 14,
  fontWeight: 500,
  padding: '10px 16px',
  borderRadius: 12,
  minHeight: 42,
  boxShadow: '0 1px 2px rgba(22,34,43,0.06)',
  cursor: 'pointer',
}

// A status chip. Tinted rather than filled, so a page of them stays calm and
// the one that matters still reads at a glance.
export function chip(status) {
  const tone = statusColor[status] ?? colors.faint
  return {
    display: 'inline-block',
    fontFamily: sans,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: tone,
    background: `${tone}17`,
    border: `1px solid ${tone}33`,
    borderRadius: 6,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
  }
}
