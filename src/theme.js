// One palette, read by every component. Calm enterprise: a cool off-white
// ground, white panels, deep slate text, and a single muted teal that carries
// interaction. Green and red appear ONLY on a verdict — if they decorated
// anything else they would stop meaning pass and fail.

export const colors = {
  ground: '#F4F6F8',
  panel: '#FFFFFF',
  panelSunk: '#EFF3F5',
  panelEdge: '#DCE3E8',
  ink: '#16222B',
  mute: '#4E5D68',
  faint: '#7C8A94',
  accent: '#1F6F8B',
  pass: '#2E7D5B',
  fail: '#B23A34',
  warn: '#8A6414',
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

export const mono = "ui-monospace, 'SF Mono', 'JetBrains Mono', Consolas, Menlo, monospace"
export const sans = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

// Border set as longhands, not the `border` shorthand: components tint one
// side (a status stripe), and mixing shorthand with longhand makes React drop
// one of them when the value changes between renders.
export const panel = {
  background: colors.panel,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: colors.panelEdge,
  borderRadius: 8,
}

export const label = {
  fontFamily: sans,
  fontSize: 11,
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
  fontSize: 12,
  padding: '6px 11px',
  borderRadius: 6,
  cursor: 'pointer',
}

export const primaryButton = {
  background: colors.accent,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  color: '#FFFFFF',
  fontFamily: sans,
  fontSize: 14,
  fontWeight: 600,
  padding: '11px 18px',
  borderRadius: 7,
  cursor: 'pointer',
}

export const secondaryButton = {
  background: colors.panel,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: colors.panelEdge,
  color: colors.ink,
  fontFamily: sans,
  fontSize: 13,
  fontWeight: 500,
  padding: '9px 14px',
  borderRadius: 7,
  cursor: 'pointer',
}

// A status chip. Tinted rather than filled, so a page of them stays calm and
// the one that matters still reads at a glance.
export function chip(status) {
  const tone = statusColor[status] ?? colors.faint
  return {
    display: 'inline-block',
    fontFamily: sans,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.07em',
    color: tone,
    background: `${tone}14`,
    border: `1px solid ${tone}40`,
    borderRadius: 4,
    padding: '2px 7px',
    whiteSpace: 'nowrap',
  }
}
