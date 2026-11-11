import { describe, expect, it } from 'vitest'
import { columnMapIssues, createRenamer, expectedColumns, mappedColumns } from '../lib/columnMap.js'
import { isIdentifier } from '../lib/identifiers.js'
import { runnableContract, runnableSpec } from '../lib/migrationObject.js'
import { objectFromPack, packIssues } from '../lib/packs.js'
import { parseCsv } from '../lib/parseCsv.js'
import { checkReadiness } from '../lib/readiness.js'
import { reconcile } from '../lib/reconcile.js'
import { referenceValues } from '../lib/rules.js'
import PACK, { TALLY_GROUP_TO_ZOHO_TYPE, ZOHO_ACCOUNT_TYPES } from './finance-tally-zoho-books.js'

// Every object of the Finance pack, on invented files: clean files pass, and
// each planted break is caught by the rule or the step it was planted for.
// Every company, party and amount here is invented.

const csv = (lines) => parseCsv(lines.join('\n'))
const object = (id) => objectFromPack(PACK, id)

// A valid GSTIN for an invented PAN: the check character that makes it so.
const gstin = (state, pan) => {
  const stem = `${state}${pan}1Z`
  for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (isIdentifier('gstin', stem + c)) return stem + c
  throw new Error('no check character')
}

const ready = (id, file, references) => {
  const o = object(id)
  return checkReadiness(runnableContract(o), file.rows, { columns: file.columns, key: o.spec?.key?.target, references })
}
const recon = (id, source, target) => {
  const o = object(id)
  return reconcile(runnableSpec(o), source.rows, target.rows, { sourceColumns: source.columns, targetColumns: target.columns })
}
const failing = (report) => report.checks.filter((c) => c.status === 'FAIL').map((c) => c.kind).sort()
const steps = (report) => Object.fromEntries(report.steps.map((s) => [s.id, s.status]))
const refs = (name, file, column) => ({ [name]: { columns: file.columns, values: { [column]: referenceValues(file.rows, column) } } })

describe('the Finance pack itself', () => {
  it('is a valid draft pack: every rule, format and spec reads, against the columns it declares', () => {
    expect(packIssues(PACK)).toEqual([])
    expect(PACK.status).toBe('draft')
    expect(PACK.objects.map((o) => o.id)).toEqual(['chart-of-accounts', 'opening-trial-balance', 'customers-and-vendors', 'open-ar-ap', 'gst-ledgers'])
  })

  it('maps every Tally group it maps to a real Zoho account type, and leaves Suspense and Branch to a person', () => {
    for (const type of Object.values(TALLY_GROUP_TO_ZOHO_TYPE)) expect(ZOHO_ACCOUNT_TYPES).toContain(type)
    expect(Object.keys(TALLY_GROUP_TO_ZOHO_TYPE)).toHaveLength(26)
    expect(TALLY_GROUP_TO_ZOHO_TYPE['Suspense A/c']).toBeUndefined()
  })

  it('a pack that breaks a definition is refused with the reason', () => {
    const bad = structuredClone(PACK)
    bad.objects[0].contract.rules.push({ kind: 'identifier', column: 'Account Name', op: 'is', target: 'swift' })
    bad.objects[1].contract.rules.push({ kind: 'nullRule', column: 'Narration', op: 'notNull' })
    bad.objects[1].spec.key.target = ['Account']
    expect(packIssues(bad).join(' | ')).toMatch(/"swift" is not a known identifier.*"Narration", which is not in the load file's columns.*target key "Account" is not in the load file's columns/)
  })
})

describe('chart of accounts', () => {
  const accounts = csv(['Account Name', 'Cash', 'HDFC Current', 'Sales', 'Office Rent', 'Accounts Receivable', 'Accounts Payable'])
  const load = csv([
    'Account Name,Account Code,Account Type,Parent Account,Description',
    'Cash,1001,Cash,,',
    'HDFC Current,1002,Bank,,',
    'Sales,4001,Income,,',
    'Office Rent,5001,Expense,,',
  ])

  it('a clean chart is ready', () => {
    expect(ready('chart-of-accounts', load, refs('accounts', accounts, 'Account Name')).status).toBe('READY')
  })

  it('a repeated name, a Tally group as account type and an unknown parent are caught', () => {
    const broken = csv([
      'Account Name,Account Code,Account Type,Parent Account,Description',
      'Cash,1001,Cash,,',
      'Cash,1003,Cash,,',
      'Sales,4001,Sales Accounts,,',
      'Travel,5002,Expense,Admin Costs,',
    ])
    const report = ready('chart-of-accounts', broken, refs('accounts', accounts, 'Account Name'))
    expect(report.status).toBe('NOT_READY')
    expect(failing(report)).toEqual(['key', 'reference', 'unique', 'valueSet'])
  })

  const tally = csv(['Name,Under', 'Cash,Cash-in-hand', 'HDFC Current,Bank Accounts', 'Sales,Sales Accounts', 'Office Rent,Indirect Expenses'])
  const zoho = csv(['Account Name,Account Type', 'cash,Cash', 'HDFC Current,Bank', 'Sales,Income', 'Office Rent,Expense'])

  it('the Tally list reconciles to the Zoho chart through the group crosswalk', () => {
    const report = recon('chart-of-accounts', tally, zoho)
    expect(report.status).toBe('PASS')
    expect(steps(report)).toMatchObject({ keys: 'PASS', completeness: 'PASS', mapping: 'PASS', accuracy: 'PASS', totals: 'SKIPPED' })
  })

  it('a ledger under Suspense A/c is a mapping gap; a wrong type in Zoho is an accuracy fault', () => {
    const t = csv(['Name,Under', 'Cash,Cash-in-hand', 'Clearing,Suspense A/c', 'Sales,Sales Accounts'])
    const z = csv(['Account Name,Account Type', 'Cash,Cash', 'Clearing,Other Current Liability', 'Sales,Other Income'])
    const report = recon('chart-of-accounts', t, z)
    expect(steps(report)).toMatchObject({ mapping: 'FAIL', accuracy: 'FAIL' })
  })
})

describe('opening trial balance', () => {
  const accounts = csv(['Account Name', 'Cash', 'HDFC Current', 'Capital', 'Sundry Creditors'])
  const load = csv(['Account Name,Debit,Credit', 'Cash,25000,0', 'HDFC Current,1225000.5,0', 'Capital,0,1000000', 'Sundry Creditors,0,250000.5'])

  it('balanced opening balances on known accounts are ready', () => {
    expect(ready('opening-trial-balance', load, refs('accounts', accounts, 'Account Name')).status).toBe('READY')
  })

  it('debits that do not equal credits fail as a file total; a negative credit and an unknown account are caught', () => {
    const broken = csv(['Account Name,Debit,Credit', 'Cash,25000,0', 'HDFC Current,1225000.5,0', 'Capital,0,-1000000', 'Suspense,0,250000.5'])
    const report = ready('opening-trial-balance', broken, refs('accounts', accounts, 'Account Name'))
    expect(report.status).toBe('NOT_READY')
    expect(failing(report)).toEqual(['aggregate', 'comparison', 'reference'])
    expect(report.checks.find((c) => c.kind === 'aggregate').fileLevel).toBe(true)
  })

  // Tally's text export in Indian digit grouping, declared by the pack (v3 F6).
  const tally = csv(['Particulars,Debit,Credit', 'Cash,"25,000.00",', 'HDFC Current,"12,25,000.50",', 'Capital,,"10,00,000.00"', 'Sundry Creditors,,"2,50,000.50"'])
  const zoho = csv(['Account Name,Debit,Credit', 'Cash,25000.00,', 'HDFC Current,1225000.50,', 'Capital,,1000000.00', 'Sundry Creditors,,250000.50'])

  it('Tally’s closing trial balance, in lakh and crore, ties to Zoho’s opening one', () => {
    const report = recon('opening-trial-balance', tally, zoho)
    expect(report.status).toBe('PASS')
    expect(steps(report)).toMatchObject({ completeness: 'PASS', accuracy: 'PASS', totals: 'PASS' })
  })

  it('a ledger left behind and a balance that changed in flight are caught at their steps', () => {
    const z = csv(['Account Name,Debit,Credit', 'Cash,25000.00,', 'HDFC Current,1225500.50,', 'Capital,,1000000.00'])
    expect(steps(recon('opening-trial-balance', tally, z))).toMatchObject({ completeness: 'FAIL', accuracy: 'FAIL', totals: 'FAIL' })
  })
})

describe('customers and vendors', () => {
  const g1 = gstin('27', 'ABCPE1234F')
  const g2 = gstin('29', 'AAPFU0939F')
  const load = csv([
    'Display Name,Contact Type,Company Name,GST Treatment,GST Identification Number (GSTIN),Place of Contact,Opening Balance',
    `Asha Traders,Customer,Asha Traders,business_registered_regular,${g1},MH,120000`,
    `Bharat Supplies,Vendor,Bharat Supplies,business_registered_regular,${g2},KA,45000`,
    'Walk-in,Customer,,consumer,,MH,0',
  ])

  it('clean contacts are ready', () => {
    expect(ready('customers-and-vendors', load).status).toBe('READY')
  })

  it('a mistyped GSTIN, a registered party without one, a repeat and a non-Zoho treatment are caught', () => {
    const typo = `${g1.slice(0, 14)}${g1.at(-1) === 'A' ? 'B' : 'A'}`
    const broken = csv([
      'Display Name,Contact Type,Company Name,GST Treatment,GST Identification Number (GSTIN),Place of Contact,Opening Balance',
      `Asha Traders,Customer,Asha Traders,business_registered_regular,${typo},MH,120000`,
      'Bharat Supplies,Vendor,Bharat Supplies,business_registered_regular,,KA,45000',
      'Bharat Supplies,Vendor,Bharat Supplies,Registered,,KA,45000',
    ])
    const report = ready('customers-and-vendors', broken)
    expect(report.status).toBe('NOT_READY')
    expect(failing(report)).toEqual(['identifier', 'key', 'nullRule', 'unique', 'valueSet'])
  })

  const tally = csv(['Name,Under,GSTIN/UIN,Closing Balance', `Asha Traders,Sundry Debtors,${g1.toLowerCase()},"1,20,000.00"`, `Bharat Supplies,Sundry Creditors,${g2},"45,000.00"`])
  const zoho = csv(['Display Name,Contact Type,GST Identification Number (GSTIN),Opening Balance', `Asha Traders,Customer,${g1},120000`, `Bharat Supplies,Vendor,${g2},45000`])

  it('Tally’s party ledgers reconcile to Zoho’s contacts, balances by customer and vendor', () => {
    const report = recon('customers-and-vendors', tally, zoho)
    expect(report.status).toBe('PASS')
    expect(steps(report)).toMatchObject({ mapping: 'PASS', accuracy: 'PASS', totals: 'PASS' })
  })

  it('a balance that changed is caught at accuracy and totals', () => {
    const z = csv(['Display Name,Contact Type,GST Identification Number (GSTIN),Opening Balance', `Asha Traders,Customer,${g1},102000`, `Bharat Supplies,Vendor,${g2},45000`])
    expect(steps(recon('customers-and-vendors', tally, z))).toMatchObject({ accuracy: 'FAIL', totals: 'FAIL' })
  })
})

describe('open receivables and payables', () => {
  const parties = csv(['Display Name', 'Asha Traders', 'Bharat Supplies'])
  const load = csv([
    'Party Name,Party Type,Document Number,Document Date,Due Date,Amount,Balance Due',
    'Asha Traders,Customer,INV-101,2027-02-10,2027-03-12,50000,20000',
    'Bharat Supplies,Vendor,BILL-7,2027-03-01,2027-03-31,45000,45000',
    'Asha Traders,Customer,INV-102,2027-03-05,2027-04-04,30000,30000',
  ])

  it('open documents for known parties are ready', () => {
    expect(ready('open-ar-ap', load, refs('parties', parties, 'Display Name')).status).toBe('READY')
  })

  it('a due date before its document, an unknown party, a repeated number and a settled document are caught', () => {
    const broken = csv([
      'Party Name,Party Type,Document Number,Document Date,Due Date,Amount,Balance Due',
      'Asha Traders,Customer,INV-101,2027-02-10,2027-01-12,50000,20000',
      'Chetan Ltd,Customer,INV-150,2027-03-01,2027-03-31,9000,9000',
      'Asha Traders,Customer,INV-101,2027-03-05,2027-04-04,30000,0',
    ])
    const report = ready('open-ar-ap', broken, refs('parties', parties, 'Display Name'))
    expect(report.status).toBe('NOT_READY')
    expect(failing(report)).toEqual(['comparison', 'crossColumn', 'key', 'reference', 'unique'])
  })

  const tally = csv(["Party's Name,Ref. No.,Date,Due on,Pending Amount", 'Asha Traders,INV-101,2027-02-10,2027-03-12,"20,000.00"', 'Asha Traders,INV-102,2027-03-05,2027-04-04,"30,000.00"', 'Bharat Supplies,BILL-7,2027-03-01,2027-03-31,"45,000.00"'])
  const zoho = csv(['Party Name,Document Number,Document Date,Due Date,Balance Due', 'Asha Traders,INV-101,2027-02-10,2027-03-12,20000', 'Asha Traders,INV-102,2027-03-05,2027-04-04,30000', 'Bharat Supplies,BILL-7,2027-03-01,2027-03-31,45000'])

  it('Tally’s bills outstanding reconcile to Zoho’s open documents, by party', () => {
    expect(recon('open-ar-ap', tally, zoho).status).toBe('PASS')
  })

  it('a bill not loaded is caught at completeness and its party’s total', () => {
    const z = csv(['Party Name,Document Number,Document Date,Due Date,Balance Due', 'Asha Traders,INV-101,2027-02-10,2027-03-12,20000', 'Bharat Supplies,BILL-7,2027-03-01,2027-03-31,45000'])
    expect(steps(recon('open-ar-ap', tally, z))).toMatchObject({ completeness: 'FAIL', totals: 'FAIL' })
  })
})

describe('GST ledgers', () => {
  const g1 = gstin('27', 'ABCPE1234F')
  const tally = csv(['GSTIN,Tax Type,Rate,Closing Balance', `${g1},CGST,9,"1,08,000.00"`, `${g1},SGST,9,"1,08,000.00"`, `${g1},IGST,18,"36,000.00"`])
  const zoho = csv(['GSTIN,Tax Type,Rate,Balance', `${g1},CGST,9,108000`, `${g1},SGST,9,108000`, `${g1},IGST,18,36000`])

  it('balances by GSTIN, tax type and rate tie', () => {
    expect(recon('gst-ledgers', tally, zoho).status).toBe('PASS')
  })

  it('a rate’s balance that moved is caught at accuracy and the GSTIN’s total', () => {
    const z = csv(['GSTIN,Tax Type,Rate,Balance', `${g1},CGST,9,108000`, `${g1},SGST,9,100800`, `${g1},IGST,18,36000`])
    expect(steps(recon('gst-ledgers', tally, z))).toMatchObject({ accuracy: 'FAIL', totals: 'FAIL' })
  })
})

// final-spec C1: the pack's headers are a guess until a pilot confirms them.
// A client's export with other headers, matched column by column, must give
// exactly the reports the pack's own headers give — clean and broken alike.
describe('a client’s own headers, matched to the pack’s', () => {
  const clientOf = (file, rename) => {
    const names = file.columns.map((column) => rename[column] ?? column)
    return { columns: names, rows: file.rows.map((row) => Object.fromEntries(file.columns.map((column, i) => [names[i], row[column]]))) }
  }
  const under = (map, file) => {
    expect(columnMapIssues(map, file.columns)).toEqual([])
    return { columns: mappedColumns(map, file.columns), rows: file.rows.map(createRenamer(map, file.columns)) }
  }
  const invert = (rename) => Object.fromEntries(Object.entries(rename).map(([expected, actual]) => [expected, actual]))

  const tally = csv(['Particulars,Debit,Credit', 'Cash,"25,000.00",', 'HDFC Current,"12,25,000.50",', 'Capital,,"10,00,000.00"', 'Sundry Creditors,,"2,50,000.50"'])
  const zohoClean = csv(['Account Name,Debit,Credit', 'Cash,25000.00,', 'HDFC Current,1225000.50,', 'Capital,,1000000.00', 'Sundry Creditors,,250000.50'])
  const zohoBroken = csv(['Account Name,Debit,Credit', 'Cash,25000.00,', 'HDFC Current,1225500.50,', 'Capital,,1000000.00'])
  const sourceNames = { Particulars: 'Ledger', Debit: 'Dr Amount', Credit: 'Cr Amount' }
  const targetNames = { 'Account Name': 'Account', Debit: 'Debit (BCY)', Credit: 'Credit (BCY)' }

  it('the definitions name exactly the columns that need matching', () => {
    const expected = expectedColumns(object('opening-trial-balance'))
    expect(expected.source).toEqual(['Particulars', 'Debit', 'Credit'])
    expect(expected.target).toEqual(['Account Name', 'Debit', 'Credit'])
    expect(expected['reference:accounts']).toEqual(['Account Name'])
  })

  for (const [label, zoho] of [['a clean load', zohoClean], ['a broken load', zohoBroken]]) {
    it(`reconciliation of ${label} is identical under the client’s headers`, () => {
      const expected = recon('opening-trial-balance', tally, zoho)
      const got = recon('opening-trial-balance', under(invert(sourceNames), clientOf(tally, sourceNames)), under(invert(targetNames), clientOf(zoho, targetNames)))
      expect(got).toEqual(expected)
    })
  }

  it('unmatched, the client’s file is not judged; a wrong match is caught by the check it breaks', () => {
    const client = clientOf(tally, sourceNames)
    expect(recon('opening-trial-balance', client, zohoClean).status).toBe('INVALID')
    // Debit and credit matched the wrong way round: every balance disagrees.
    const swapped = under({ Particulars: 'Ledger', Debit: 'Cr Amount', Credit: 'Dr Amount' }, client)
    expect(steps(recon('opening-trial-balance', swapped, zohoClean))).toMatchObject({ completeness: 'PASS', accuracy: 'FAIL' })
  })

  it('load readiness is identical under the client’s headers, the reference file’s included', () => {
    const accounts = csv(['Account Name', 'Cash', 'Capital'])
    const load = csv(['Account Name,Debit,Credit', 'Cash,25000,0', 'Capital,0,-20000', 'Suspense,0,5000'])
    const expected = ready('opening-trial-balance', load, refs('accounts', accounts, 'Account Name'))
    expect(expected.status).toBe('NOT_READY')
    const loadNames = { 'Account Name': 'account', Debit: 'DR', Credit: 'CR' }
    const clientAccounts = under({ 'Account Name': 'Ledger name' }, clientOf(accounts, { 'Account Name': 'Ledger name' }))
    const got = ready('opening-trial-balance', under(invert(loadNames), clientOf(load, loadNames)), refs('accounts', clientAccounts, 'Account Name'))
    expect(got).toEqual(expected)
  })
})
