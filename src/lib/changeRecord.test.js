import { describe, expect, it } from 'vitest'
import { checkChange } from './changeContract.js'
import { cleanCustody, missingForFinal, selfChecked } from './changeCustody.js'
import { changeFingerprint, createChangeRecord } from './changeRecord.js'
import { NEVER_CLAIM } from './signoff.js'

// A salary revision that broke its contract. Invented people and amounts.
const CONTRACT = { name: 'FY27 revision', key: ['Emp Code'], approved: { key: ['Emp Code'] }, fields: { Basic: { policy: 'bounded', direction: 'up', maxPercent: 20, onlyFor: 'approved' } } }
const BEFORE = [{ 'Emp Code': 'E1', Name: 'Asha Rao', Basic: '50000' }, { 'Emp Code': 'E2', Name: 'Vikram Shah', Basic: '61000' }]
const AFTER = [{ 'Emp Code': 'E1', Name: 'Asha Rao', Basic: '65000' }, { 'Emp Code': 'E2', Name: 'Vikram Shah', Basic: '64000' }]
const APPROVED = [{ 'Emp Code': 'E1' }]
const FILES = {
  before: { name: 'before.csv', rows: 2, bytes: 80, sha256: 'a'.repeat(64) },
  after: { name: 'after.csv', rows: 2, bytes: 80, sha256: 'b'.repeat(64) },
  approved: { name: 'approved.csv', rows: 1, bytes: 12, sha256: 'c'.repeat(64) },
}
const INDEPENDENT = {
  mover: 'Payroll bureau',
  contract: { by: 'adviser', name: 'R. Iyer & Co' },
  before: { by: 'business', name: 'HR ops', at: '2026-11-10' },
  after: { by: 'business', name: 'HR ops', at: '2026-11-12' },
  approved: { by: 'business' },
  ran: { by: 'adviser' },
}
const report = checkChange(CONTRACT, BEFORE, AFTER, { approved: APPROVED })
const record = (extra = {}) => createChangeRecord({ report, contract: CONTRACT, files: FILES, custody: INDEPENDENT, generatedBy: 'the workspace', generatedAt: '2026-11-14T10:00:00Z', ...extra })
const text = (html) => html.replace(/<[^>]+>/g, ' ')

describe('custody', () => {
  it('keeps only known parties, bounded strings and ISO dates', () => {
    const c = cleanCustody({ mover: 'x'.repeat(500), before: { by: 'hacker', at: 'yesterday', name: 'A' }, contract: { by: 'pack' }, ran: { by: 'pack' }, extra: 'Asha' })
    expect(c.mover).toHaveLength(120)
    expect(c.before).toEqual({ by: '', name: 'A', at: '' })
    expect(c.contract.by).toBe('pack')
    expect(c.ran.by).toBe('') // only a contract can come from a pack
    expect(JSON.stringify(c)).not.toMatch(/Asha/)
  })

  it('names every way a check is self-checked, and nothing when the inputs came from elsewhere', () => {
    expect(selfChecked(INDEPENDENT)).toEqual([])
    const self = selfChecked({ ...INDEPENDENT, contract: { by: 'mover' }, after: { by: 'mover', at: '2026-11-12' } })
    expect(self).toEqual(['The contract was written by whoever made the change.', 'The after file was exported by whoever made the change.'])
  })

  it('a final record needs who made the change and who exported each file, and when', () => {
    expect(missingForFinal(INDEPENDENT)).toEqual([])
    expect(missingForFinal({})).toEqual(['who made the change', 'who exported the before file', 'when the before file was exported', 'who exported the after file', 'when the after file was exported'])
  })
})

describe('the change record', () => {
  it('states the verdict, the custody, the files by SHA-256 and the contract by fingerprint', async () => {
    const { html, reference } = await record()
    expect(reference).toMatch(/^CR-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
    expect(html).toContain('Not allowed')
    expect(html).toContain('a'.repeat(64))
    expect(html).toContain((await changeFingerprint(CONTRACT)).sha256)
    expect(html).toContain('R. Iyer &amp; Co')
    expect(text(html)).toMatch(/changed by 30%, above the allowed 20%/)
    expect(html).not.toMatch(/Self-checked/)
    expect(html).not.toMatch(/DRAFT/)
  })

  it('is labelled self-checked on its first page when the mover wrote the contract', async () => {
    const { html } = await record({ custody: { ...INDEPENDENT, contract: { by: 'mover' } } })
    const front = html.slice(0, html.indexOf('</header>'))
    expect(front).toMatch(/<strong>Self-checked\.<\/strong>/)
    expect(front).toContain('The contract was written by whoever made the change.')
  })

  it('is a draft without the export fields', async () => {
    const { html } = await record({ custody: { mover: 'Payroll bureau' } })
    expect(html).toMatch(/DRAFT/)
    expect(text(html)).toMatch(/draft, not a final record: it does not state who exported the before file/)
  })

  it('masks a tagged column, and shows it only when asked', async () => {
    const masked = (await record({ tags: { Basic: 'pay' } })).html
    expect(masked).not.toMatch(/65000|64000|61000/)
    expect(masked).toMatch(/Masked in this record/)
    const shown = (await record({ tags: { Basic: 'pay' }, unmask: true })).html
    expect(shown).toMatch(/65000/)
    expect(shown).toMatch(/contains unmasked personal data/)
  })

  it('escapes hostile values and can run nothing', async () => {
    const evil = '<script>alert(1)</script>'
    const r = checkChange({ key: ['id'] }, [{ id: '1', a: 'x' }], [{ id: '1', a: evil }])
    const { html } = await createChangeRecord({ report: r, contract: { key: ['id'], name: evil }, files: { before: { ...FILES.before, name: evil }, after: FILES.after }, custody: { mover: evil } })
    expect(html).not.toContain(evil)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/<script/i)
    expect(html).toMatch(/default-src 'none'/)
  })

  it('never makes a claim it must not make, and refuses a check that could not run', async () => {
    const { html } = await record({ custody: { ...INDEPENDENT, contract: { by: 'mover' } } })
    expect(NEVER_CLAIM.filter((pattern) => pattern.test(text(html))).map(String)).toEqual([])
    await expect(createChangeRecord({ report: checkChange({ key: ['nope'] }, BEFORE, AFTER), contract: {}, files: FILES })).rejects.toThrow(/could not run/)
  })
})
