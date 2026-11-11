import { describe, expect, it } from 'vitest'
import { cleanColumnMap, columnMapIssues, createRenamer, expectedColumns, mappedColumns, proposeMatches, renameRows } from './columnMap.js'
import { migrationObjectToJson, newMigrationObject, parseMigrationObjectFile } from './migrationObject.js'

// Column matching (final-spec C1): a definition expects "Name"; the client's
// export says "Ledger Name". The match is declared, never guessed, and holds
// column names only.

describe('the column map as saved', () => {
  it('keeps trimmed column names under known roles and drops everything else', () => {
    expect(cleanColumnMap({
      source: { Name: ' Ledger Name ', Under: 'Under', '': 'x', Blank: '' },
      'reference:accounts': { 'Account Name': 'Account' },
      nonsense: { a: 'b' },
      target: 'not a map',
      load: { Amount: 42, Debit: { nested: true } },
    })).toEqual({ source: { Name: 'Ledger Name' }, 'reference:accounts': { 'Account Name': 'Account' } })
    expect(cleanColumnMap(null)).toEqual({})
  })

  it('is saved with the object and read back; an object without one reads as before', () => {
    const object = { ...newMigrationObject('Chart'), columnMap: { source: { Name: 'Ledger Name' }, junk: { a: 'b' } } }
    const json = migrationObjectToJson(object)
    expect(parseMigrationObjectFile(json).object.columnMap).toEqual({ source: { Name: 'Ledger Name' } })
    expect(migrationObjectToJson(newMigrationObject('Chart'))).not.toContain('columnMap')
    expect(parseMigrationObjectFile(migrationObjectToJson(newMigrationObject('Chart'))).object.columnMap).toEqual({})
  })
})

describe('a map against a file', () => {
  const file = ['Ledger Name', 'Parent', 'Closing Balance']

  it('renames the matched columns and leaves the rest, in file order', () => {
    const map = { Name: 'Ledger Name', Under: 'Parent' }
    expect(columnMapIssues(map, file)).toEqual([])
    expect(mappedColumns(map, file)).toEqual(['Name', 'Under', 'Closing Balance'])
    const rename = createRenamer(map, file)
    expect(rename({ 'Ledger Name': 'Cash', Parent: 'Cash-in-hand', 'Closing Balance': '10' })).toEqual({ Name: 'Cash', Under: 'Cash-in-hand', 'Closing Balance': '10' })
  })

  it('an empty map changes nothing and hands back the same row', () => {
    const row = { a: '1' }
    expect(createRenamer({}, ['a'])(row)).toBe(row)
    expect(mappedColumns(undefined, ['a'])).toEqual(['a'])
  })

  it('two columns may swap names', () => {
    const map = { Debit: 'Credit', Credit: 'Debit' }
    expect(columnMapIssues(map, ['Debit', 'Credit'])).toEqual([])
    expect(createRenamer(map, ['Debit', 'Credit'])({ Debit: '1', Credit: '2' })).toEqual({ Credit: '1', Debit: '2' })
  })

  it('refuses a match to a column the file lacks, one file column used twice, and a name the file already uses', () => {
    expect(columnMapIssues({ Name: 'Ledger' }, file)).toEqual(['"Name" is matched to "Ledger", which this file does not have.'])
    expect(columnMapIssues({ Name: 'Parent', Under: 'Parent' }, file)).toEqual(['"Parent" is matched to both "Name" and "Under"; a file column can stand for only one.'])
    expect(columnMapIssues({ Parent: 'Ledger Name' }, file)).toEqual(['"Ledger Name" cannot be read as "Parent": this file already has a column "Parent".'])
  })

  it('re-maps rows that were already renamed, without the original file', () => {
    const rows = [{ Name: 'Cash', Parent: 'Cash-in-hand' }]
    expect(renameRows(rows, ['Name', 'Parent'], ['Ledger Name', 'Under'])).toEqual([{ 'Ledger Name': 'Cash', Under: 'Cash-in-hand' }])
    expect(renameRows(rows, ['Name', 'Parent'], ['Name', 'Parent'])).toBe(rows)
  })
})

describe('proposals — the tool proposes, the person accepts', () => {
  it('proposes a file column whose name differs only in case, spaces and punctuation', () => {
    expect(proposeMatches(['Account Name', 'GSTIN/UIN', 'Debit'], ['account_name', 'GSTIN UIN', 'Debit', 'Narration']))
      .toEqual([{ expected: 'Account Name', actual: 'account_name' }, { expected: 'GSTIN/UIN', actual: 'GSTIN UIN' }])
  })

  it('proposes nothing when two file columns would fit, when the column is already matched, or when names merely resemble', () => {
    expect(proposeMatches(['Name'], ['name', 'NAME'])).toEqual([])
    expect(proposeMatches(['Name'], ['name'], { Name: 'name' })).toEqual([])
    expect(proposeMatches(['Name'], ['Ledger Name'])).toEqual([])
    expect(proposeMatches(['Name', 'Other'], ['name'], { Other: 'name' })).toEqual([])
  })
})

describe('the columns an object’s definitions read, by file', () => {
  it('lists each role’s columns from the rules, the key and the spec', () => {
    const object = {
      contract: { rules: [
        { kind: 'nullRule', column: 'Account Name', op: 'notNull' },
        { kind: 'crossColumn', column: 'Due', op: '>=', target: 'Date', targetIsColumn: true, when: { column: 'Type', op: '=', target: 'Bill' } },
        { kind: 'reference', column: 'Parent', op: 'in', target: { file: 'accounts', column: 'Account Name' } },
        { kind: 'aggregate', column: 'Debit', fn: 'sum', op: '=', target: 'Credit', targetIsColumn: true, groupBy: 'Branch' },
      ] },
      spec: {
        key: { source: ['Name'], target: ['Account Name'] },
        scope: { source: { column: 'Status', op: '=', target: 'A' } },
        mapping: [{ source: 'Under', target: 'Account Type' }],
        totals: [{ source: 'Closing', target: 'Opening', groupBy: { source: 'Under', target: 'Account Type' } }, { fn: 'count', groupBy: { source: 'City', target: 'Location' } }],
      },
    }
    expect(expectedColumns(object)).toEqual({
      load: ['Account Name', 'Due', 'Date', 'Type', 'Parent', 'Debit', 'Credit', 'Branch'],
      source: ['Name', 'Status', 'Under', 'Closing', 'City'],
      target: ['Account Name', 'Account Type', 'Opening', 'Location'],
      'reference:accounts': ['Account Name'],
    })
    expect(expectedColumns({})).toEqual({ load: [], source: [], target: [] })
  })
})
