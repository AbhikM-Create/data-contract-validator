// The finance example: an opening trial balance moving from Tally to Zoho Books,
// built from the Finance pack — the same object a partner starts from.
//
// One invented company, ten ledgers, in its first mock load. One story, told by
// both checks:
//
//   - the load file carries a typing slip — HDFC Current is 12,25,500.50 where
//     the books say 12,25,000.50 — so its debits no longer equal its credits
//     (a FILE TOTAL), and a "Suspense" ledger the Zoho chart does not have;
//   - it was loaded anyway. Zoho refused Suspense, so one ledger never arrived
//     (completeness), the slip arrived with the bank balance (accuracy), and
//     neither control total ties.
//
// Tally's export writes amounts in lakh and crore, which the pack declares.
// Every name and amount here is invented. No date is measured against today.

import { objectFromPack } from '../lib/packs.js'
import FINANCE from '../packs/finance-tally-zoho-books.js'

// [ledger, debit, credit] as the old books close.
const LEDGERS = [
  ['Cash', 25000, 0],
  ['HDFC Current', 1225000.5, 0],
  ['Sundry Debtors', 340000, 0],
  ['Stock-in-hand', 510000, 0],
  ['Furniture', 180000, 0],
  ['Capital', 0, 1500000],
  ['Sundry Creditors', 0, 250000.5],
  ['GST Payable', 0, 45000],
  ['Unsecured Loan', 0, 460000],
  ['Suspense', 0, 25000],
]
const SLIP = { ledger: 'HDFC Current', debit: 1225500.5 }
const NOT_IN_CHART = 'Suspense'

const csv = (header, rows) => `${[header, ...rows].join('\n')}\n`
const plain = (amount) => (amount === 0 ? '' : amount.toFixed(2))

// 1225000.5 -> "12,25,000.50": the last three digits, then pairs.
function indian(amount) {
  if (amount === 0) return ''
  const [whole, paise] = amount.toFixed(2).split('.')
  const head = whole.slice(0, -3)
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}` : whole
  return `"${grouped}.${paise}"`
}

// Tally's closing trial balance, ledger-wise.
export function financeSource() {
  return csv('Particulars,Debit,Credit', LEDGERS.map(([name, debit, credit]) => `${name},${indian(debit)},${indian(credit)}`))
}

// The file prepared for Zoho Books' opening balances, with the slip.
export function financeLoadFile() {
  return csv('Account Name,Debit,Credit', LEDGERS.map(([name, debit, credit]) => `${name},${plain(name === SLIP.ledger ? SLIP.debit : debit)},${plain(credit)}`))
}

// Zoho Books' trial balance after the load: Suspense was refused, the slip arrived.
export function financeTarget() {
  return csv('Account Name,Debit,Credit', LEDGERS.filter(([name]) => name !== NOT_IN_CHART)
    .map(([name, debit, credit]) => `${name},${plain(name === SLIP.ledger ? SLIP.debit : debit)},${plain(credit)}`))
}

// Zoho Books' chart of accounts: what the opening balances may be posted to.
export function financeAccounts() {
  return csv('Account Name', LEDGERS.filter(([name]) => name !== NOT_IN_CHART).map(([name]) => name))
}

export function financeSampleObject() {
  return { ...objectFromPack(FINANCE, 'opening-trial-balance'), wave: 'Wave 1', cycle: 'Mock 1', runs: [] }
}

export const FINANCE_SAMPLE = {
  sourceName: 'tally_trial_balance.csv',
  targetName: 'zoho_trial_balance_after_mock1.csv',
  loadName: 'zoho_opening_balances_mock1.csv',
  accountsName: 'zoho_chart_of_accounts.csv',
}
