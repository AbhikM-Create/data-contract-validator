// Finance pack: TallyPrime → Zoho Books (India). v3-spec §6.1.
//
// DRAFT. Every Zoho value below is from Zoho's own documentation (sources); the
// column headers of Tally's exports and Zoho's import and report files are the
// ones Zoho and Tally show on screen, and are listed under `toConfirm` until a
// pilot has run this pack on real exports. Then it becomes verified, with the
// date and the export versions it was checked against.
//
// Standard codes only — Tally's predefined groups, Zoho's account types and GST
// treatments. Never a client's ledgers, parties or amounts.

// Zoho Books account types, as Zoho's chart-of-accounts help lists them.
export const ZOHO_ACCOUNT_TYPES = [
  'Other Asset', 'Other Current Assets', 'Cash', 'Bank', 'Fixed Asset', 'Stock', 'Payment Clearing', 'Accounts Receivable', 'Deferred Tax Asset',
  'Other Current Liability', 'Credit Card', 'Long Term Liability', 'Other Liability', 'Overseas Tax Payable', 'Accounts Payable', 'Deferred Tax Liability',
  'Equity', 'Income', 'Other Income', 'Expense',
]

// Zoho Books (India) GST treatment values for imports.
export const ZOHO_GST_TREATMENTS = ['business_registered_regular', 'business_registered_composition', 'business_sez', 'business_unregistered', 'consumer', 'overseas']

// TallyPrime's 28 predefined groups → a Zoho account type. A TEMPLATE to agree
// with the client's accountant: Suspense A/c and Branch/Divisions are left out
// on purpose, so a ledger under them is a mapping gap someone must decide, and
// so is any group the client created.
export const TALLY_GROUP_TO_ZOHO_TYPE = {
  'Bank Accounts': 'Bank',
  'Bank OD A/c': 'Other Current Liability',
  'Cash-in-hand': 'Cash',
  'Deposits (Asset)': 'Other Current Assets',
  'Loans & Advances (Asset)': 'Other Current Assets',
  'Stock-in-hand': 'Stock',
  'Sundry Debtors': 'Accounts Receivable',
  'Current Assets': 'Other Current Assets',
  'Fixed Assets': 'Fixed Asset',
  Investments: 'Other Asset',
  'Misc. Expenses (ASSET)': 'Other Asset',
  'Capital Account': 'Equity',
  'Reserves & Surplus': 'Equity',
  'Current Liabilities': 'Other Current Liability',
  'Duties & Taxes': 'Other Current Liability',
  Provisions: 'Other Current Liability',
  'Sundry Creditors': 'Accounts Payable',
  'Loans (Liability)': 'Long Term Liability',
  'Secured Loans': 'Long Term Liability',
  'Unsecured Loans': 'Long Term Liability',
  'Sales Accounts': 'Income',
  'Direct Incomes': 'Income',
  'Indirect Incomes': 'Other Income',
  'Purchase Accounts': 'Expense',
  'Direct Expenses': 'Expense',
  'Indirect Expenses': 'Expense',
}

// Tally's export of amounts: Indian digit grouping, declared (v3 F6). A typed
// Excel export reads the same whatever is declared (parseXlsx.js).
const TALLY = { grouping: 'indian' }
const ZOHO = {}

const notNull = (column) => ({ kind: 'nullRule', column, op: 'notNull', target: null })
const notNullWhen = (column, whenColumn, value) => ({ ...notNull(column), when: { column: whenColumn, op: '=', target: value } })

export default {
  id: 'finance-tally-zoho-books',
  version: '0.1.0',
  status: 'draft',
  verified: null,
  name: 'Finance — Tally to Zoho Books',
  path: { source: 'TallyPrime', target: 'Zoho Books (India)' },
  sources: [
    { what: 'Zoho Books account types', url: 'https://www.zoho.com/books/help/accountant/chart-of-accounts.html', read: '2026-11-09' },
    { what: 'Zoho Books GST import headers and values (GST Treatment, GSTIN, place of supply)', url: 'https://www.zoho.com/in/books/kb/gst/gst-import-format.html', read: '2026-11-09' },
    { what: 'Zoho Books: migrate from Tally (exports to take; opening-balance checks)', url: 'https://www.zoho.com/books/help/migration/tally-to-zoho-books.html', read: '2026-11-02' },
    { what: 'TallyPrime predefined groups (15 primary, 13 sub-groups)', url: 'https://help.tallysolutions.com/ledgers-and-groups-in-tallyprime/', read: '2026-11-09' },
  ],
  toConfirm: [
    'Column headers of each Tally export (List of Accounts, Trial Balance, Ledger list, Bills Outstanding) as the client’s TallyPrime release writes them.',
    'Whether Tally writes amounts as one signed column, Dr/Cr suffixes, or separate Debit and Credit columns.',
    'Tally’s date style in text exports (e.g. 1-Apr-2026, which has no declared format yet); Excel exports carry typed dates.',
    'Column headers of Zoho Books’ import sample files and of its Trial Balance, Contacts and Aged Receivables/Payables exports.',
    'The Zoho Books India account-type list against the global list used here.',
    'The Tally group → Zoho account type crosswalk, with the client’s accountant.',
    'Whether Zoho’s Trial Balance export leaves the zero side of a balance blank, as Tally does, or writes 0 — the two read as different values.',
  ],
  objects: [
    {
      id: 'chart-of-accounts',
      name: 'Chart of accounts',
      guide: {
        export: 'In TallyPrime, export the List of Accounts (ledgers with the group each is under).',
        load: 'The Zoho Books chart-of-accounts import file.',
        compare: 'After the load, export the chart of accounts from Zoho Books and reconcile it against the Tally list.',
      },
      columns: {
        load: ['Account Name', 'Account Code', 'Account Type', 'Parent Account', 'Description'],
        source: ['Name', 'Under'],
        target: ['Account Name', 'Account Type'],
      },
      formats: { load: ZOHO, source: TALLY, target: ZOHO },
      contract: {
        name: 'Chart of accounts (Zoho Books)',
        rules: [
          notNull('Account Name'),
          { kind: 'unique', column: 'Account Name', op: 'unique' },
          notNull('Account Type'),
          { kind: 'valueSet', column: 'Account Type', op: 'in', target: ZOHO_ACCOUNT_TYPES },
          // A parent must already exist: in Zoho, or earlier in this file. Open a
          // file of every account name (Zoho's export plus this file) as "accounts".
          { kind: 'reference', column: 'Parent Account', op: 'in', target: { file: 'accounts', column: 'Account Name' }, severity: 'warn' },
        ],
      },
      spec: {
        key: { source: ['Name'], target: ['Account Name'], normalize: ['ignoreCase'] },
        mapping: [{ source: 'Under', target: 'Account Type', map: TALLY_GROUP_TO_ZOHO_TYPE }],
        totals: [],
      },
      scope: 'Ledgers and their account types only; no balances (see the opening trial balance).',
    },
    {
      id: 'opening-trial-balance',
      name: 'Opening trial balance',
      guide: {
        export: 'In TallyPrime, export the Trial Balance at the closing date of the old books, closing balances, ledger-wise.',
        load: 'The opening balances entered or imported into Zoho Books, as one file of account, debit and credit.',
        compare: 'After the load, export Zoho Books’ Trial Balance as at the opening date and reconcile it, ledger by ledger, against Tally’s closing trial balance.',
      },
      columns: {
        load: ['Account Name', 'Debit', 'Credit'],
        source: ['Particulars', 'Debit', 'Credit'],
        // The target key is also the load file's key (readiness reads it there).
        target: ['Account Name', 'Debit', 'Credit'],
      },
      formats: { load: ZOHO, source: TALLY, target: ZOHO },
      contract: {
        name: 'Opening balances (Zoho Books)',
        rules: [
          notNull('Account Name'),
          { kind: 'unique', column: 'Account Name', op: 'unique' },
          { kind: 'type', column: 'Debit', op: '=', target: 'numeric' },
          { kind: 'type', column: 'Credit', op: '=', target: 'numeric' },
          { kind: 'comparison', column: 'Debit', op: '>=', target: '0' },
          { kind: 'comparison', column: 'Credit', op: '>=', target: '0' },
          // Zoho's own check: total debits equal total credits.
          { kind: 'aggregate', column: 'Debit', fn: 'sum', op: '=', target: 'Credit', targetIsColumn: true, tolerance: 0.01 },
          { kind: 'reference', column: 'Account Name', op: 'in', target: { file: 'accounts', column: 'Account Name' } },
        ],
      },
      spec: {
        key: { source: ['Particulars'], target: ['Account Name'], normalize: ['ignoreCase'] },
        mapping: [
          { source: 'Debit', target: 'Debit', tolerance: 0.01 },
          { source: 'Credit', target: 'Credit', tolerance: 0.01 },
        ],
        totals: [
          { source: 'Debit', target: 'Debit' },
          { source: 'Credit', target: 'Credit' },
        ],
      },
      scope: 'Balances as at the cutover date only; transaction history is not compared.',
    },
    {
      id: 'customers-and-vendors',
      name: 'Customers and vendors',
      guide: {
        export: 'In TallyPrime, export the ledgers under Sundry Debtors and Sundry Creditors with GSTIN and closing balance.',
        load: 'One file of contacts with a Contact Type column (Customer or Vendor), split into Zoho Books’ customer and vendor imports.',
        compare: 'After the load, export customers and vendors from Zoho Books into one file and reconcile it against Tally’s party ledgers.',
      },
      columns: {
        load: ['Display Name', 'Contact Type', 'Company Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Place of Contact', 'Opening Balance'],
        source: ['Name', 'Under', 'GSTIN/UIN', 'Closing Balance'],
        target: ['Display Name', 'Contact Type', 'GST Identification Number (GSTIN)', 'Opening Balance'],
      },
      formats: { load: ZOHO, source: TALLY, target: ZOHO },
      contract: {
        name: 'Contacts (Zoho Books)',
        rules: [
          notNull('Display Name'),
          { kind: 'valueSet', column: 'Contact Type', op: 'in', target: ['Customer', 'Vendor'] },
          { kind: 'unique', column: 'Display Name', op: 'unique', target: ['Contact Type'] },
          notNull('GST Treatment'),
          { kind: 'valueSet', column: 'GST Treatment', op: 'in', target: ZOHO_GST_TREATMENTS },
          { kind: 'identifier', column: 'GST Identification Number (GSTIN)', op: 'is', target: 'gstin' },
          notNullWhen('GST Identification Number (GSTIN)', 'GST Treatment', 'business_registered_regular'),
          notNullWhen('GST Identification Number (GSTIN)', 'GST Treatment', 'business_registered_composition'),
          notNullWhen('GST Identification Number (GSTIN)', 'GST Treatment', 'business_sez'),
          { kind: 'type', column: 'Opening Balance', op: '=', target: 'numeric' },
        ],
      },
      spec: {
        key: { source: ['Name'], target: ['Display Name'], normalize: ['ignoreCase'] },
        mapping: [
          { source: 'Under', target: 'Contact Type', map: { 'Sundry Debtors': 'Customer', 'Sundry Creditors': 'Vendor' } },
          { source: 'GSTIN/UIN', target: 'GST Identification Number (GSTIN)', ignoreCase: true },
          { source: 'Closing Balance', target: 'Opening Balance', tolerance: 0.01 },
        ],
        totals: [
          { source: 'Closing Balance', target: 'Opening Balance', groupBy: { source: 'Under', target: 'Contact Type', map: { 'Sundry Debtors': 'Customer', 'Sundry Creditors': 'Vendor' } } },
        ],
      },
      scope: 'Party masters and their balances; addresses, contacts and bank details are not compared.',
    },
    {
      id: 'open-ar-ap',
      name: 'Open receivables and payables',
      guide: {
        export: 'In TallyPrime, export Bills Outstanding — receivables and payables — bill-wise, with the party, bill reference, date, due date and pending amount.',
        load: 'The open invoices and bills to import into Zoho Books, with the party, document number, dates and balance due.',
        compare: 'After the load, export the open documents from Zoho Books (the aged receivables and payables, document-wise) and reconcile them against Tally’s bills outstanding.',
      },
      columns: {
        load: ['Party Name', 'Party Type', 'Document Number', 'Document Date', 'Due Date', 'Amount', 'Balance Due'],
        source: ["Party's Name", 'Ref. No.', 'Date', 'Due on', 'Pending Amount'],
        target: ['Party Name', 'Document Number', 'Document Date', 'Due Date', 'Balance Due'],
      },
      formats: { load: ZOHO, source: TALLY, target: ZOHO },
      contract: {
        name: 'Open invoices and bills (Zoho Books)',
        rules: [
          notNull('Party Name'),
          notNull('Document Number'),
          { kind: 'valueSet', column: 'Party Type', op: 'in', target: ['Customer', 'Vendor'] },
          { kind: 'unique', column: 'Document Number', op: 'unique', target: ['Party Type'] },
          { kind: 'reference', column: 'Party Name', op: 'in', target: { file: 'parties', column: 'Display Name' } },
          { kind: 'type', column: 'Document Date', op: '=', target: 'date' },
          { kind: 'crossColumn', column: 'Due Date', op: '>=', target: 'Document Date', targetIsColumn: true },
          { kind: 'type', column: 'Balance Due', op: '=', target: 'numeric' },
          { kind: 'comparison', column: 'Balance Due', op: '>', target: '0' },
          { kind: 'crossColumn', column: 'Balance Due', op: '<=', target: 'Amount', targetIsColumn: true, severity: 'warn' },
        ],
      },
      spec: {
        key: { source: ["Party's Name", 'Ref. No.'], target: ['Party Name', 'Document Number'], normalize: ['ignoreCase'] },
        mapping: [
          { source: 'Pending Amount', target: 'Balance Due', tolerance: 0.01 },
          { source: 'Due on', target: 'Due Date' },
        ],
        totals: [
          { source: 'Pending Amount', target: 'Balance Due', groupBy: { source: "Party's Name", target: 'Party Name' } },
        ],
      },
      scope: 'Open documents and balances by party; ageing buckets are not compared, because neither export carries them as data.',
    },
    {
      id: 'gst-ledgers',
      name: 'GST ledgers',
      guide: {
        export: 'From TallyPrime’s GST ledgers, a file of closing balance by GSTIN, tax type (CGST, SGST, IGST, cess) and rate.',
        load: 'Not a load: GST balances arrive with the opening trial balance. This object only proves they tie.',
        compare: 'After the load, the same file from Zoho Books’ GST accounts, reconciled by GSTIN, tax type and rate.',
      },
      columns: {
        load: [],
        source: ['GSTIN', 'Tax Type', 'Rate', 'Closing Balance'],
        target: ['GSTIN', 'Tax Type', 'Rate', 'Balance'],
      },
      formats: { source: TALLY, target: ZOHO },
      contract: { name: 'GST ledgers', rules: [] },
      spec: {
        key: { source: ['GSTIN', 'Tax Type', 'Rate'], target: ['GSTIN', 'Tax Type', 'Rate'], normalize: ['ignoreCase'] },
        mapping: [{ source: 'Closing Balance', target: 'Balance', tolerance: 0.01 }],
        totals: [{ source: 'Closing Balance', target: 'Balance', groupBy: { source: 'GSTIN', target: 'GSTIN' } }],
      },
      scope: 'GST ledger balances only; GST returns (GSTR-1, GSTR-3B) are not re-checked.',
    },
  ],
}
