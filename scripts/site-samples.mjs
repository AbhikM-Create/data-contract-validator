// The published samples: real output from the real engine, run at site-build
// time on the invented example files, so a sample can never drift from what
// the product makes. Each record ships with the files it was made from and the
// definitions it ran, so a reader can re-check it: sha256sum the files, run
// the command printed in the record, and get the same answer.
//
// Every person, company and amount in them is invented; each record says so
// on its first page, above everything else.

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { changeContractToJson } from '../src/lib/changeContractFile.js'
import { createChangeRecord } from '../src/lib/changeRecord.js'
import { createEvidencePack } from '../src/lib/evidencePack.js'
import { createMasker } from '../src/lib/masking.js'
import { migrationObjectToJson, runnableContract, runnableSpec } from '../src/lib/migrationObject.js'
import { parseCsv, toCsv } from '../src/lib/parseCsv.js'
import { checkReadiness } from '../src/lib/readiness.js'
import { reconcile } from '../src/lib/reconcile.js'
import { dcvCommand, workspaceReproduce } from '../src/lib/reproduce.js'
import { referenceValues, RULE_KINDS } from '../src/lib/rules.js'
import { ownersOf } from '../src/lib/signoff.js'
import { VERSION } from '../src/lib/version.js'
import { CHANGE_SAMPLE, changeAfter, changeApproved, changeBefore, changeContract, changeCustody, changeTags } from '../src/samples/changeSample.js'
import { MIGRATION_EXAMPLES } from '../src/samples/migrationExamples.js'

const DIR = 'samples'
const FINANCE = MIGRATION_EXAMPLES.find((e) => e.id === 'finance')
const TB_OBJECT = 'trial-balance.migration.json'
const GENERATED_BY = `the Plumbstep website build, as a sample — data-contract-validator ${VERSION}`

// What every sample record says first.
const BANNER = '<div class="notice unmasked"><strong>A sample.</strong> Made by Plumbstep from invented files: every person, company and amount in it is made up. The files it names are published beside it, so you can check their fingerprints and run the check again yourself.</div>'
const withBanner = (html) => html.replace('<header class="page">', `<header class="page">\n${BANNER}`)

const fileInfo = (name, text, rows) => {
  const bytes = Buffer.from(text, 'utf8')
  return { name, rows, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

// The samples, as the site lists them. `inputs` are the files a reader needs to
// re-check the record.
export const SAMPLES = [
  {
    id: 'salary-revision',
    title: 'A salary revision — the change record',
    blurb: 'A payroll bureau’s revision, checked against the contract the business’s CA wrote. Not allowed: a bank account changed that nothing allowed to change, and one Basic rose 30% against a 20% cap. Pay and identifiers are masked.',
    record: `${DIR}/salary-revision-change-record.html`,
    inputs: [CHANGE_SAMPLE.contractName, CHANGE_SAMPLE.beforeName, CHANGE_SAMPLE.afterName, CHANGE_SAMPLE.approvedName, 'salary-revision.tags.json'].map((f) => `${DIR}/${f}`),
  },
  {
    id: 'trial-balance',
    title: 'An opening trial balance — the evidence pack and fix list',
    blurb: 'Tally to Zoho Books, first mock load. Before the load, one typing slip breaks the file total; after it, one ledger never arrived and neither control total ties. Every difference has an owner; the decisions and signatures are left for the people who would make them.',
    record: `${DIR}/trial-balance-evidence-pack.html`,
    extra: `${DIR}/trial-balance-fix-list.csv`,
    inputs: [TB_OBJECT, ...FINANCE.files.map((f) => f.name)].map((f) => `${DIR}/${f}`),
  },
]

async function changeSample(out) {
  const files = {
    before: fileInfo(CHANGE_SAMPLE.beforeName, changeBefore, parseCsv(changeBefore).rows.length),
    after: fileInfo(CHANGE_SAMPLE.afterName, changeAfter, parseCsv(changeAfter).rows.length),
    approved: fileInfo(CHANGE_SAMPLE.approvedName, changeApproved, parseCsv(changeApproved).rows.length),
  }
  const { checkChange } = await import('../src/lib/changeContract.js')
  const report = checkChange(changeContract, parseCsv(changeBefore).rows, parseCsv(changeAfter).rows, { approved: parseCsv(changeApproved).rows, exampleLimit: 25 })
  const reproduce = dcvCommand('change', [CHANGE_SAMPLE.contractName, CHANGE_SAMPLE.beforeName, CHANGE_SAMPLE.afterName, '--approved', CHANGE_SAMPLE.approvedName, '--tags', 'salary-revision.tags.json'])
  const record = await createChangeRecord({ report, contract: changeContract, files, custody: changeCustody, tags: changeTags, generatedBy: GENERATED_BY, reproduce })
  const write = (name, text) => writeFileSync(join(out, DIR, name), text)
  write('salary-revision-change-record.html', withBanner(record.html))
  write(CHANGE_SAMPLE.contractName, changeContractToJson(changeContract))
  write(CHANGE_SAMPLE.beforeName, changeBefore)
  write(CHANGE_SAMPLE.afterName, changeAfter)
  write(CHANGE_SAMPLE.approvedName, changeApproved)
  write('salary-revision.tags.json', `${JSON.stringify(changeTags, null, 2)}\n`)
  return { record, report }
}

// The finance example, run as the workspace runs it: readiness on the load
// file with its reference file, reconciliation of source against target.
async function trialBalanceSample(out) {
  const example = FINANCE
  const object = example.object()
  // An example's file text is a function (the drift samples are dated from today).
  const files = example.files.map((f) => ({ ...f, text: typeof f.text === 'function' ? f.text() : f.text }))
  const text = Object.fromEntries(files.map((f) => [f.role, f]))
  const rowsOf = (role) => parseCsv(text[role].text)
  const contract = runnableContract(object)
  const key = object.spec.key.target.filter(Boolean)

  const references = {}
  const referenceFiles = []
  for (const rule of contract.rules ?? []) {
    if (rule?.kind !== RULE_KINDS.REFERENCE || !rule.target?.file) continue
    const ref = text[`reference:${rule.target.file}`]
    if (!ref) continue
    const parsed = parseCsv(ref.text)
    const entry = references[rule.target.file] ?? { columns: parsed.columns, values: {} }
    entry.values[rule.target.column] = referenceValues(parsed.rows, rule.target.column)
    references[rule.target.file] = entry
    if (!referenceFiles.some((r) => r.name === rule.target.file)) referenceFiles.push({ name: rule.target.file, file: fileInfo(ref.name, ref.text, parsed.rows.length) })
  }

  const load = rowsOf('load')
  const { flagged, ...readiness } = checkReadiness(contract, load.rows, { columns: load.columns, key, references })
  const source = rowsOf('source')
  const target = rowsOf('target')
  const recon = reconcile(runnableSpec(object), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns, exampleLimit: 25 })

  const objectFile = TB_OBJECT
  const reproduce = workspaceReproduce({
    objectFile,
    load: text.load.name,
    references: Object.fromEntries(referenceFiles.map((r) => [r.name, r.file.name])),
    source: text.source.name,
    target: text.target.name,
    key,
  })
  const pack = await createEvidencePack({
    object,
    readiness: { report: { ...readiness, flaggedCount: flagged.length }, flaggedCount: flagged.length, file: fileInfo(text.load.name, text.load.text, load.rows.length), references: referenceFiles },
    reconciliation: { report: recon, source: fileInfo(text.source.name, text.source.text, source.rows.length), target: fileInfo(text.target.name, text.target.text, target.rows.length) },
    generatedBy: GENERATED_BY,
    reproduce,
  })

  // The fix list, exactly as the workspace writes it (engineWorker.js).
  const mask = createMasker(object.tags, { keys: key })
  const fixList = toCsv(
    [...load.columns, '_row', '_readiness', '_reasons', '_owner'],
    flagged.map((f) => [...load.columns.map((c) => mask(c, load.rows[f.row - 1][c])), f.row, f.severity === 'reject' ? 'REJECT' : 'WARN', f.reasons.join('; '), ownersOf(object).readiness]),
  )

  const write = (name, body) => writeFileSync(join(out, DIR, name), body)
  write('trial-balance-evidence-pack.html', withBanner(pack.html))
  write('trial-balance-fix-list.csv', fixList)
  write(objectFile, migrationObjectToJson(object))
  for (const f of files) write(f.name, f.text)
  return { pack, readiness, recon, flagged }
}

// Writes every sample under out/samples/. Returns what was made, for tests.
export async function buildSamples(out) {
  mkdirSync(join(out, DIR), { recursive: true })
  const change = await changeSample(out)
  const trialBalance = await trialBalanceSample(out)
  return { change, trialBalance }
}
