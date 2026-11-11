import { describe, expect, it } from 'vitest'
import { migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from '../samples/migrationSample.js'
import { createEvidencePack } from './evidencePack.js'
import { cleanTags, createMasker, maskReadiness, maskReconciliation, maskValue } from './masking.js'
import { migrationObjectToJson, parseMigrationObjectFile, runnableContract, runnableSpec } from './migrationObject.js'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { reconcile } from './reconcile.js'

describe('masking — values', () => {
  it('identifiers keep their last 4; personal and pay become [masked]; blanks stay blank', () => {
    expect(maskValue('ABCPE1234F', 'identifier')).toBe('••••••234F')
    expect(maskValue('123412341234', 'aadhaar')).toBe('••••••••1234')
    expect(maskValue('OKAFOR', 'personal')).toBe('[masked]')
    expect(maskValue('52000.00', 'pay')).toBe('[masked]')
    expect(maskValue('', 'pay')).toBe('')
    expect(maskValue('abc', 'identifier')).toBe('•••')
  })

  it('keys show; unmasking shows the rest; Aadhaar is masked whatever is asked', () => {
    const tags = { employee_id: 'identifier', pan: 'identifier', aadhaar: 'aadhaar', salary: 'pay' }
    const masked = createMasker(tags, { keys: ['employee_id'] })
    expect(masked('employee_id', 'E40117')).toBe('E40117')
    expect(masked('pan', 'ABCPE1234F')).toBe('••••••234F')
    const open = createMasker(tags, { unmask: true })
    expect(open('salary', '52000')).toBe('52000')
    expect(open('aadhaar', '123412341234')).toBe('••••••••1234')
    expect(createMasker({ aadhaar: 'aadhaar' }, { keys: ['aadhaar'] })('aadhaar', '123412341234')).toBe('••••••••1234')
  })

  it('a tag is a column name and one of four words — anything else is dropped', () => {
    expect(cleanTags({ pan: 'identifier', x: 'secret', '': 'pay', y: 'pay' })).toEqual({ pan: 'identifier', y: 'pay' })
    expect(cleanTags('nope')).toEqual({})
  })

  it('tags are saved with the object and read back; a hand-edited tag cannot carry a value', () => {
    const object = { ...migrationSampleObject(), tags: { last_name: 'personal', annual_salary: 'pay' } }
    const json = JSON.parse(migrationObjectToJson(object))
    expect(json.tags).toEqual({ last_name: 'personal', annual_salary: 'pay' })
    json.tags.first_name = 'Ada Okafor'
    expect(parseMigrationObjectFile(JSON.stringify(json)).object.tags).toEqual({ last_name: 'personal', annual_salary: 'pay' })
  })
})

// The leak test: real reports of the example migration, every non-key column
// tagged, masked — and not one value of a tagged column left in what leaves.
describe('masking — nothing tagged leaves', () => {
  const object = migrationSampleObject()
  const spec = runnableSpec(object)
  const load = parseCsv(migrationLoadFile())
  const source = parseCsv(migrationSource())
  const target = parseCsv(migrationTarget())
  const keys = new Set([...spec.key.source, ...spec.key.target])
  const tags = {}
  for (const column of [...source.columns, ...target.columns, ...load.columns]) {
    if (!keys.has(column)) tags[column] = /salary|ANSAL/i.test(column) ? 'pay' : 'personal'
  }
  const readiness = checkReadiness(runnableContract(object), load.rows, { columns: load.columns, key: spec.key.target })
  const recon = reconcile(spec, source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns, exampleLimit: 1000 })

  const taggedValues = new Set()
  for (const { rows } of [load, source, target]) {
    for (const row of rows) for (const [column, value] of Object.entries(row)) if (tags[column] && String(value).length > 3) taggedValues.add(String(value))
  }
  // Values that are also keys or authored rule/spec text may legitimately appear.
  const allowed = new Set([...load.rows, ...source.rows, ...target.rows].flatMap((r) => [...keys].map((k) => r[k])))
  const authored = JSON.stringify([object.contract, object.spec])
  const leaked = (text) => [...taggedValues].filter((v) => !allowed.has(v) && !authored.includes(v) && text.includes(v))

  it('the reports really quote tagged values before masking', () => {
    expect(leaked(JSON.stringify([readiness, recon])).length).toBeGreaterThan(2)
  })

  it('masked readiness and reconciliation quote none of them', () => {
    const r = maskReadiness(readiness, createMasker(tags, { keys: spec.key.target }), spec.key.target)
    const c = maskReconciliation(recon, spec, createMasker(tags, { keys: [...keys] }))
    expect(leaked(JSON.stringify([r, c]))).toEqual([])
    // The counts and verdicts are untouched.
    expect(r.counts).toEqual(readiness.counts)
    expect(c.counts).toEqual(recon.counts)
    expect(c.steps.map((s) => s.status)).toEqual(recon.steps.map((s) => s.status))
  })

  it('the evidence pack quotes none of them, says what it masked — and unmasked, says so', async () => {
    const tagged = { ...object, tags }
    const base = {
      object: tagged,
      readiness: { report: readiness, flaggedCount: 0, file: { name: 'load.csv', rows: load.rows.length, bytes: 1, sha256: 'a' } },
      reconciliation: { report: recon, source: { name: 's.csv', rows: 1, bytes: 1, sha256: 'b' }, target: { name: 't.csv', rows: 1, bytes: 1, sha256: 'c' } },
      generatedAt: '2026-11-03T10:00:00Z',
      generatedBy: 'test',
    }
    const masked = (await createEvidencePack(base)).html
    expect(leaked(masked)).toEqual([])
    expect(masked).toContain('Masked in this pack')

    const unmasked = (await createEvidencePack({ ...base, unmask: true })).html
    expect(unmasked).toContain('This pack contains unmasked personal data.')
    expect(leaked(unmasked).length).toBeGreaterThan(0) // negative control
  })
})

describe('masking — suggestions from column names', () => {
  it('proposes from the name alone, and proposes nothing for ordinary columns', async () => {
    const { suggestTag } = await import('./masking.js')
    expect(['aadhaar_no', 'PAN', 'employee_pan', 'bank_account_no', 'annual_salary', 'ANSAL', 'last_name', 'NACHN', 'mobile', 'grade', 'company_code', 'hire_date', 'employee_id']
      .map((c) => [c, suggestTag(c)]))
      .toEqual([
        ['aadhaar_no', 'aadhaar'], ['PAN', 'identifier'], ['employee_pan', 'identifier'], ['bank_account_no', 'identifier'], ['annual_salary', 'pay'], ['ANSAL', 'pay'],
        ['last_name', 'personal'], ['NACHN', 'personal'], ['mobile', 'personal'], ['grade', null], ['company_code', null], ['hire_date', null], ['employee_id', null],
      ])
  })
})

// Review of M1 (2026-11-09): what still left the screen unmasked.
describe('masking — the headline, per-person totals and count totals', () => {
  const rows = [
    { id: 'E1', name: 'Asha Kulkarni', company: 'IN01', salary: '91234' },
    { id: 'E2', name: 'Ravi Shetty', company: 'IN01', salary: '45678' },
  ]
  const columns = ['id', 'name', 'company', 'salary']
  const tags = { name: 'personal', salary: 'pay' }

  it('the readiness headline says what failed without the tagged group or the person’s amount', () => {
    const report = checkReadiness({ rules: [{ kind: 'aggregate', column: 'salary', fn: 'sum', groupBy: 'name', op: '<=', target: '50000' }] }, rows, { columns, key: ['id'] })
    expect(report.headline).toContain('Asha Kulkarni') // the report really quotes it before masking
    const masked = maskReadiness(report, createMasker(tags, { keys: ['id'] }), ['id'])
    expect(JSON.stringify(masked)).not.toMatch(/Asha Kulkarni|91,?234/)
    expect(masked.headline).toMatch(/^Not ready\. A file-level check fails: the sum of "salary" must be at most 50000 for each "name" \(name \[masked\]: \[masked\]\)\.$/)
  })

  it('a total of a tagged amount per record key is one person’s pay: masked; per company it stays', () => {
    const perPerson = checkReadiness({ rules: [{ kind: 'aggregate', column: 'salary', fn: 'sum', groupBy: 'id', op: '<=', target: '50000' }] }, rows, { columns, key: ['id'] })
    const maskedPerson = maskReadiness(perPerson, createMasker(tags, { keys: ['id'] }), ['id'])
    expect(JSON.stringify(maskedPerson)).not.toMatch(/91,?234/)
    expect(maskedPerson.checks.find((c) => c.fileLevel).groups).toEqual([{ group: 'E1', value: 'id E1: [masked]' }])

    const perCompany = checkReadiness({ rules: [{ kind: 'aggregate', column: 'salary', fn: 'sum', groupBy: 'company', op: '<=', target: '50000' }] }, rows, { columns, key: ['id'] })
    expect(JSON.stringify(maskReadiness(perCompany, createMasker(tags, { keys: ['id'] }), ['id']))).toMatch(/136,?912/) // negative control: a company total is not a person's pay
  })

  const target = rows.map((r) => ({ ...r, salary: r.id === 'E1' ? '99999' : r.salary }))
  const spec = (totals) => ({ key: { source: 'id', target: 'id' }, mapping: [], totals })
  const recon = (totals) => reconcile(spec(totals), rows, target, { sourceColumns: columns, targetColumns: columns })

  it('a reconciliation total per employee leaves without its amounts; per company with them', () => {
    const totals = [{ source: 'salary', target: 'salary', groupBy: { source: 'id', target: 'id' } }]
    const report = recon(totals)
    const masked = maskReconciliation(report, spec(totals), createMasker(tags, { keys: ['id'] }))
    expect(JSON.stringify(report)).toMatch(/99,?999/)
    expect(JSON.stringify(masked)).not.toMatch(/91,?234|99,?999|8,?765/)
    expect(masked.steps.find((s) => s.id === 'totals').findings[0].examples[0]).toMatchObject({ key: 'E1', detail: 'amounts masked in this output', source: null, target: null, difference: null, masked: true })
    expect(masked.totals[0].groups[0]).toMatchObject({ group: 'E1', source: null, target: null, difference: null, masked: true, ties: false })

    const company = [{ source: 'salary', target: 'salary', groupBy: { source: 'company', target: 'company' } }]
    expect(JSON.stringify(maskReconciliation(recon(company), spec(company), createMasker(tags, { keys: ['id'] })))).toMatch(/145,?677/)
  })

  it('a count total grouped by a tagged column leaves with its group names masked', () => {
    const totals = [{ fn: 'count', groupBy: { source: 'name', target: 'name' } }]
    const masked = maskReconciliation(recon(totals), spec(totals), createMasker(tags, { keys: ['id'] }))
    expect(JSON.stringify(masked)).not.toMatch(/Asha|Ravi/)
    expect(masked.totals[0].groups.map((g) => g.source)).toEqual([1, 1]) // counts are not pay
  })
})
