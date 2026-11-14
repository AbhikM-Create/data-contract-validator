import { useEffect } from 'react'

// The descent: the one animation that explains the product (approved 14 Nov
// 2026). The plumb bob drops onto the first step, walks down the staircase one
// step at a time, and stops on the step that caught the problem; each step it
// passes settles into its verdict as the bob arrives, and the steps below the
// stop settle last.
//
// Rules it keeps (CLAUDE.md, UI): motion explains a process, never decorates
// one. It plays ONCE per result in a session, lasts under three seconds, and
// with "reduce motion" set it does not play at all — the drawing is simply in
// its final state. It replays a result already known: it never stands in for
// progress the engine has not reported. The drawing's static markup IS the
// final state, so a page that never runs this script (or a browser without the
// Web Animations API) shows exactly what it would have ended on.

export const DROP_MS = 450
export const STEP_MS = 420
export const SETTLE_MS = 280
export const LIFT = 46

// descentTimeline(rests, stopAt) -> where the bob is at each moment, and when
// each step settles. Pure, so a test can hold the timing to its limits.
//   rests   each step's resting point [x, y] (isoStair's `rest`)
//   stopAt  the index the bob stops on
export function descentTimeline(rests, stopAt) {
  const stop = Math.max(0, Math.min(stopAt, rests.length - 1))
  const [x0, y0] = rests[0]
  const points = [[x0, y0 - LIFT], ...rests.slice(0, stop + 1)]
  const times = [0, DROP_MS]
  for (let i = 1; i <= stop; i += 1) times.push(DROP_MS + i * STEP_MS)
  const end = times[times.length - 1]
  const settleAt = rests.map((_, i) => (i <= stop ? times[i + 1] : end + STEP_MS / 2))
  const total = Math.max(...settleAt) + SETTLE_MS
  return { points, times, end, settleAt, total, final: rests[stop] }
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// The idle faces, in the order a step's polygons are drawn: right, front, top.
const IDLE = ['var(--face-idle-right)', 'var(--face-idle-front)', 'var(--face-idle-top)']
const EASE = 'cubic-bezier(0.33, 1, 0.68, 1)'

// Results that have already played this session. A result replays only when
// it changes; moving between screens does not make it dance again.
const played = new Set()

// useDescent(ref, { rests, stopAt, beamY, key }) plays the descent on the SVG
// in `ref`. The SVG marks its parts with data-descent: "carriage" (beam, line
// and bob, moved sideways), "string" (the line, stretched), "bob" (moved down),
// and data-descent-step="i" on each step's group of polygons (data-descent-label="i"
// on its number, if it has one).
export function useDescent(ref, { rests, stopAt, beamY, key }) {
  useEffect(() => {
    const svg = ref.current
    if (!svg || typeof svg.animate !== 'function' || prefersReducedMotion() || played.has(key)) return undefined
    const carriage = svg.querySelector('[data-descent="carriage"]')
    const string = svg.querySelector('[data-descent="string"]')
    const bob = svg.querySelector('[data-descent="bob"]')
    if (!carriage || !string || !bob) return undefined
    played.add(key)

    const t = descentTimeline(rests, stopAt)
    const [fx, fy] = t.final
    const length = fy - 19 - beamY
    const frames = (style) => t.points.map((point, i) => ({ ...style(point), offset: t.times[i] / t.end, easing: EASE }))
    const move = { duration: t.end, fill: 'backwards' }
    const animations = [
      carriage.animate(frames(([x]) => ({ transform: `translateX(${x - fx}px)` })), move),
      bob.animate(frames(([, y]) => ({ transform: `translateY(${y - fy}px)` })), move),
      string.animate(frames(([, y]) => ({ transform: `scaleY(${Math.max(0.05, (y - 19 - beamY) / length)})` })), move),
    ]
    for (const step of svg.querySelectorAll('[data-descent-step]')) {
      const i = Number(step.getAttribute('data-descent-step'))
      step.querySelectorAll('polygon').forEach((face, j) => {
        const to = getComputedStyle(face)
        animations.push(face.animate(
          [{ fill: IDLE[j], stroke: 'var(--face-edge)', strokeWidth: '1' }, { fill: to.fill, stroke: to.stroke, strokeWidth: to.strokeWidth }],
          { duration: SETTLE_MS, delay: t.settleAt[i], fill: 'backwards', easing: 'ease-out' },
        ))
      })
    }
    // A step's number takes its verdict colour with the step, not before it.
    for (const label of svg.querySelectorAll('[data-descent-label]')) {
      const i = Number(label.getAttribute('data-descent-label'))
      animations.push(label.animate([{ fill: 'var(--faint)' }, { fill: getComputedStyle(label).fill }], { duration: SETTLE_MS, delay: t.settleAt[i], fill: 'backwards', easing: 'ease-out' }))
    }
    // Held on its first frame until the drawing is on screen, so a staircase
    // below the fold plays when it is seen, not while nobody is looking.
    animations.forEach((a) => a.pause())
    const start = () => animations.forEach((a) => a.play())
    let observer = null
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); start() }
      }, { threshold: 0.35 })
      observer.observe(svg)
    } else {
      start()
    }
    return () => {
      observer?.disconnect()
      // Interrupted (a re-render in development, a quick navigation): it has
      // not really played, so it may play next time.
      if (animations.some((a) => a.playState !== 'finished')) played.delete(key)
      animations.forEach((a) => a.cancel())
    }
  }, [ref, key]) // eslint-disable-line react-hooks/exhaustive-deps
}
