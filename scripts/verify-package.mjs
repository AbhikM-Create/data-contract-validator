// What a pipeline — or an auditor — installs (final-spec C8).
//
// Packs the CLI exactly as `npm publish` would, installs the tarball into an
// empty prefix, and uses ONLY that copy: builds an object from a pack, checks a
// broken file, writes a sign-off record, then runs the re-run command the
// record itself prints and expects the same answer. A file missing from
// package.json "files", or a record whose re-run block cannot be run, fails
// here before it fails for someone else.
//
//   node scripts/verify-package.mjs      (npm run verify:package)

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'dcv-package-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const failures = []
const check = (what, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || !detail ? '' : `\n     ${detail}`}`)
  if (!ok) failures.push(what)
}

try {
  execFileSync(npm, ['pack', '--pack-destination', temp], { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' })
  const tarball = readdirSync(temp).find((name) => name.endsWith('.tgz'))
  const prefix = join(temp, 'prefix')
  execFileSync(npm, ['install', '--global', '--prefix', prefix, join(temp, tarball)], { stdio: 'pipe', shell: process.platform === 'win32' })
  const installed = [join(prefix, 'lib', 'node_modules'), join(prefix, 'node_modules')].map((dir) => join(dir, 'data-contract-validator')).find(existsSync)
  check('the tarball installs into an empty prefix', Boolean(installed))
  if (!installed) throw new Error('the package did not install')

  // The installed copy must not lean on this checkout: no tests, no browser-only modules.
  const shipped = readdirSync(join(installed, 'src', 'lib'))
  check('no test file and no browser-only module ships', !shipped.some((name) => /\.test\.js$|engineWorker|parseXlsx|supabase/.test(name)), shipped.filter((name) => /\.test\.js$|engineWorker|parseXlsx|supabase/.test(name)).join(', '))

  const work = join(temp, 'work')
  execFileSync(process.execPath, ['-e', `require('node:fs').mkdirSync(${JSON.stringify(work)})`])
  const dcv = (...args) => {
    const run = spawnSync(process.execPath, [join(installed, 'bin', 'dcv.mjs'), ...args], { cwd: work, encoding: 'utf8' })
    return { code: run.status, out: run.stdout, err: run.stderr }
  }

  const version = dcv('--version')
  const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  check(`dcv --version reports ${expected}`, version.code === 0 && version.out.includes(expected), version.out + version.err)

  check('dcv pack list names both packs', /finance-tally-zoho-books/.test(dcv('pack', 'list').out) && /hr-payroll-zoho-payroll/.test(dcv('pack', 'list').out))
  const made = dcv('pack', 'finance-tally-zoho-books', 'opening-trial-balance', '--out', 'tb.migration.json')
  check('dcv pack writes an object from a pack', made.code === 0, made.err)

  // Debits 100, credits 90: the file total does not tie. Every value invented.
  writeFileSync(join(work, 'accounts.csv'), 'Account Name\nCash\nCapital\n')
  writeFileSync(join(work, 'load.csv'), 'Account Name,Debit,Credit\nCash,100,0\nCapital,0,90\n')
  const checked = dcv('check', 'tb.migration.json', 'load.csv', '--reference', 'accounts=accounts.csv', '--evidence', 'record.html')
  check('dcv check finds the planted break (exit 1) and writes the record', checked.code === 1 && existsSync(join(work, 'record.html')), checked.err)

  // The record's own re-run block, run as printed, against the installed copy.
  const record = existsSync(join(work, 'record.html')) ? readFileSync(join(work, 'record.html'), 'utf8') : ''
  const line = record.match(/<pre>(dcv check [^<]+)<\/pre>/)?.[1]?.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  check('the record prints a dcv re-run command', Boolean(line), 'no <pre>dcv check …</pre> in the record')
  if (line) {
    const args = line.split(' ').slice(1).filter((arg) => arg !== '--evidence' && arg !== 'record.html')
    const rerun = dcv(...args)
    check(`the record’s re-run command gives the same answer: ${line}`, rerun.code === 1 && /does not tie|sum of "Debit"/.test(rerun.out + rerun.err), `exit ${rerun.code}\n${rerun.err}`)
  }
  check('the record names the tool version', record.includes(expected))

  writeFileSync(join(work, 'tally.csv'), 'Particulars,Debit,Credit\nCash,100.00,\nCapital,,100.00\n')
  writeFileSync(join(work, 'zoho.csv'), 'Account Name,Debit,Credit\nCash,100.00,\nCapital,,100.00\n')
  const reconciled = dcv('reconcile', 'tb.migration.json', 'tally.csv', 'zoho.csv', '--json')
  check('dcv reconcile passes a clean pair (exit 0) with a versioned report', reconciled.code === 0 && /reconcile-report:1/.test(reconciled.out), reconciled.err)

  const shared = dcv('share', 'tb.migration.json')
  check('dcv share writes definitions', shared.code === 0 && /"shared"/.test(shared.out), shared.err)
  check('an unknown option is refused (exit 2)', dcv('check', 'tb.migration.json', 'load.csv', '--nope').code === 2)
} catch (error) {
  check('the package can be packed, installed and run', false, error.message)
} finally {
  rmSync(temp, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check${failures.length === 1 ? '' : 's'} failed.`)
  process.exit(1)
}
console.log('\nThe packed CLI installs and runs on its own.')
