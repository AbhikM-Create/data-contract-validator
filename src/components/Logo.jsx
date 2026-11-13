import { colors } from '../theme.js'

// The Plumbstep mark: a staircase (the report's descent to the step that caught
// the problem) and a plumb line with its bob (the test of true). The steps are
// ink, the line and bob teal — never green or red, which belong to verdicts.
// `inverse` is for dark grounds. Decorative wherever the name sits beside it.
export default function Logo({ size = 24, inverse = false, title }) {
  const ink = inverse ? '#F4F6F8' : colors.ink
  const plumb = inverse ? '#5AAECB' : colors.accent
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <path d="M6 12H18V24H30V36H40" fill="none" stroke={ink} strokeWidth="5.5" strokeLinejoin="round" />
      <line x1="50" y1="5" x2="50" y2="40" stroke={plumb} strokeWidth="4" />
      <path d="M42.5 40H57.5L50 59Z" fill={plumb} />
    </svg>
  )
}
