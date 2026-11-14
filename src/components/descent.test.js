import { describe, expect, it } from 'vitest'
import { descentTimeline, DROP_MS, STEP_MS } from './descent.js'
import { isoStair } from './isoStair.js'

const rests = (n) => isoStair(n).steps.map((s) => s.rest)

describe('the descent', () => {
  it('drops onto the first step, then visits each step down to the stop, in order', () => {
    const t = descentTimeline(rests(6), 2)
    expect(t.points).toHaveLength(4) // above the stair, then steps 1, 2 and 3
    expect(t.points[1]).toEqual(rests(6)[0])
    expect(t.final).toEqual(rests(6)[2])
    expect(t.times).toEqual([0, DROP_MS, DROP_MS + STEP_MS, DROP_MS + 2 * STEP_MS])
    // the bob only ever moves down and to the right
    for (let i = 1; i < t.points.length; i += 1) expect(t.points[i][1]).toBeGreaterThan(t.points[i - 1][1])
  })

  it('settles each step as the bob arrives, and the steps below the stop after it', () => {
    const t = descentTimeline(rests(5), 3)
    expect(t.settleAt.slice(0, 4)).toEqual(t.times.slice(1))
    expect(t.settleAt[4]).toBeGreaterThan(t.end)
  })

  it('stays under three seconds for the longest staircase, stopping on its last step', () => {
    for (const n of [4, 5, 6]) expect(descentTimeline(rests(n), n - 1).total).toBeLessThan(3000)
  })

  it('clamps a stop outside the staircase rather than reading past it', () => {
    expect(descentTimeline(rests(4), 9).final).toEqual(rests(4)[3])
    expect(descentTimeline(rests(4), -1).final).toEqual(rests(4)[0])
  })
})
