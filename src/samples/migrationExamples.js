// The worked migration examples, in the order a first-time visitor sees them:
// finance first — the cutover most partners run — then the employee migration.
// Each is an object plus the files it is checked against, by role.

import { FINANCE_SAMPLE, financeAccounts, financeLoadFile, financeSampleObject, financeSource, financeTarget } from './financeSample.js'
import { MIGRATION_SAMPLE, migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from './migrationSample.js'

export const MIGRATION_EXAMPLES = [
  {
    id: 'finance',
    name: 'Finance — an opening trial balance',
    path: 'Tally to Zoho Books · first mock load',
    blurb: 'Ten ledgers. One typing slip in the load file breaks the file total before the load; after it, one ledger never arrived and neither control total ties.',
    object: financeSampleObject,
    files: [
      { role: 'source', name: FINANCE_SAMPLE.sourceName, text: financeSource },
      { role: 'target', name: FINANCE_SAMPLE.targetName, text: financeTarget },
      { role: 'load', name: FINANCE_SAMPLE.loadName, text: financeLoadFile },
      { role: 'reference:accounts', name: FINANCE_SAMPLE.accountsName, text: financeAccounts },
    ],
    notice: 'Example opened: an invented opening trial balance, Tally to Zoho Books, in Wave 1, Mock 1 — built from the draft Finance pack. Every ledger and amount is made up. Check the load file, then reconcile.',
  },
  {
    id: 'employees',
    name: 'HR — an employee master',
    path: 'A legacy HR system to a new one · second mock load',
    blurb: 'Forty-six employees. Two blank surnames would be rejected; one legacy grade has no crosswalk entry; two salaries lost their decimal point in flight.',
    object: migrationSampleObject,
    files: [
      { role: 'source', name: MIGRATION_SAMPLE.sourceName, text: migrationSource },
      { role: 'target', name: MIGRATION_SAMPLE.targetName, text: migrationTarget },
      { role: 'load', name: MIGRATION_SAMPLE.loadName, text: migrationLoadFile },
    ],
    // The load file is the one prepared for the NEXT load, which is why it is
    // named for Mock 3 while the target extract is what Mock 2 left behind.
    notice: 'Example opened: an invented employee migration in Wave 1, Mock 2. Every person in it is made up. The target extract is what Mock 2 loaded; the load file is the one prepared for the next load, Mock 3. Check the load file, then reconcile.',
  },
]

export const findMigrationExample = (id) => MIGRATION_EXAMPLES.find((example) => example.id === id) ?? MIGRATION_EXAMPLES.find((example) => example.id === 'employees')
