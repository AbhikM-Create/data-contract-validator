import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { dcvCommand, shellArg, workspaceReproduce } from './reproduce.js'

// Splits a line the way a POSIX shell would for the quoting shellArg produces:
// bare words, and single-quoted runs with '\'' for an embedded quote.
function posixSplit(line) {
  const words = []
  let word = ''
  let quoted = false
  let started = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quoted) {
      if (c === "'") quoted = false
      else word += c
    } else if (c === "'") {
      quoted = true
      started = true
    } else if (c === '\\') {
      word += line[i + 1]
      i += 1
      started = true
    } else if (c === ' ') {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += c
      started = true
    }
  }
  if (started) words.push(word)
  return words
}

describe('the evidence pack re-run block', () => {
  it('names dcv, never node scripts/*.mjs', () => {
    const block = workspaceReproduce({ objectFile: 'employees.migration.json', load: 'load.csv', source: 's.csv', target: 't.csv', key: ['employee_id'] })
    expect(block).not.toMatch(/node |scripts\//)
    expect(block.split('\n').slice(1)).toEqual([
      'dcv check employees.migration.json load.csv --key employee_id',
      'dcv reconcile employees.migration.json s.csv t.csv',
    ])
  })

  it('includes only the checks the pack includes', () => {
    expect(workspaceReproduce({ objectFile: 'o.json', source: 's.csv', target: 't.csv' }).split('\n')).toHaveLength(2)
    expect(workspaceReproduce({ objectFile: 'o.json', load: 'l.csv' })).toMatch(/\ndcv check o\.json l\.csv$/)
    expect(workspaceReproduce({ objectFile: 'o.json' })).toBeNull()
  })

  it('quotes names a shell would split, and a shell reads them back exactly', () => {
    const names = ['load file.csv', "O'Brien export.csv", 'a$b.csv', 'semi;colon.csv', 'tab\tname.csv', '']
    for (const name of names) {
      const line = dcvCommand('check', ['o.json', name, '--key', 'emp id,company'])
      expect(posixSplit(line)).toEqual(['dcv', 'check', 'o.json', name, '--key', 'emp id,company'])
    }
    expect(shellArg('plain_name-1.csv')).toBe('plain_name-1.csv')
  })

  // Not a mock: the printed line, split as a shell would, runs the real CLI.
  it('the printed reconcile line runs the real CLI', () => {
    const line = workspaceReproduce({ objectFile: 'missing object.json', source: 's.csv', target: 't.csv' }).split('\n')[1]
    const [, ...args] = posixSplit(line)
    const run = spawnSync(process.execPath, ['bin/dcv.mjs', ...args], { encoding: 'utf8' })
    // The object file does not exist: "could not complete" (2), with its name
    // read whole — space included — not "command not found" or a module error.
    expect(run.status).toBe(2)
    expect(`${run.stderr}${run.stdout}`).toContain('missing object.json')
    expect(`${run.stderr}${run.stdout}`).not.toMatch(/MODULE_NOT_FOUND/)
  })
})
