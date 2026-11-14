// The geometry of the isometric staircase (Direction C, 14 Nov 2026): n solid
// steps descending to the right, each one rise lower than the one before, seen
// from the standard isometric angle. Pure — numbers in, polygons out — so the
// drawing is the same wherever it appears and a test can hold it.
//
// A point (x along the stair, y into it, z up) lands on screen at
//   X = (x − y)·cos30°,  Y = (x + y)·sin30° − z.
// Faces are drawn back to front — each step's right face, its front, its top —
// and steps left to right, so a lower step covers the riser of the one above.

const COS = Math.cos(Math.PI / 6)
const SIN = 0.5

export function isoStair(count, { width = 70, depth = 90, rise = 34, top = 64, pad = 8 } = {}) {
  const n = Math.max(1, Math.floor(count))
  const ox = depth * COS + pad
  const oy = n * rise + top
  const point = (x, y, z) => [round(ox + (x - y) * COS), round(oy + (x + y) * SIN - z)]
  const poly = (...pts) => pts.map((p) => p.join(',')).join(' ')

  const steps = []
  for (let i = 0; i < n; i += 1) {
    const x0 = width * i
    const x1 = width * (i + 1)
    const z = rise * (n - i)
    steps.push({
      right: poly(point(x1, 0, 0), point(x1, depth, 0), point(x1, depth, z), point(x1, 0, z)),
      front: poly(point(x0, depth, 0), point(x1, depth, 0), point(x1, depth, z), point(x0, depth, z)),
      top: poly(point(x0, 0, z), point(x1, 0, z), point(x1, depth, z), point(x0, depth, z)),
      // Where a label sits on the top face, and where the plumb bob rests: a
      // point toward the back-right of the face, so the line hanging above it
      // clears every higher step.
      label: point(x0 + width * 0.42, depth * 0.5, z),
      rest: point(x0 + width * 0.75, depth * 0.25, z),
    })
  }
  const widthPx = round(ox + n * width * COS + pad)
  const heightPx = round(oy + (n * width + depth) * SIN + pad)
  return { steps, width: widthPx, height: heightPx, beamY: round(top * 0.35) }
}

const round = (value) => Math.round(value * 10) / 10
