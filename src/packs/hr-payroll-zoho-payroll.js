// HR pack: mid-year payroll → Zoho Payroll (India). v3-spec §6.2.
//
// DRAFT. The load files' headers for the employee master are the field names
// Zoho Payroll's import help lists (sources). Zoho does not publish its
// prior-payroll sample file — it is shown only in the Configure Prior Payroll
// screen — so the register's component headers, the legacy payroll's export
// headers and Zoho's report headers are listed under `toConfirm` until a pilot
// has run this pack on real exports. Then it becomes verified, with the date
// and the export versions it was checked against.
//
// greytHR, the other target in v3 §6.2 (D2), is not in this pack: its import
// templates are not public. A greytHR pack waits on a pilot's sample files.
//
// Standard codes and statutory rules only — never a client's employees, pay
// components, locations or amounts. Every pay and identifier column is tagged
// (§5.2), on both sides, so a report that leaves the screen masks them.

// The legacy payroll's export of amounts: Indian digit grouping, declared (v3
// F6). The date style of each side is a declared guess, to confirm.
const LEGACY = { grouping: 'indian', date: 'DD/MM/YYYY' }
const ZOHO = { date: 'DD/MM/YYYY' }

// Constitution of India, Art. 276(2): professional tax is capped at ₹2,500 per
// person per year, whatever the state's slabs.
export const PROFESSIONAL_TAX_CAP = 2500

const notNull = (column, extra = {}) => ({ kind: 'nullRule', column, op: 'notNull', target: null, ...extra })
const whenFilled = (column) => ({ when: { column, op: 'notNull', target: null } })
const amount = (column) => [
  { kind: 'type', column, op: '=', target: 'numeric' },
  { kind: 'comparison', column, op: '>=', target: '0' },
]

// The register's components as this pack expects them in the load file. A
// component the file lacks makes its rules UNCHECKED (rule:missing-column), so
// the file is never called ready without it.
export const REGISTER_COMPONENTS = ['Basic', 'House Rent Allowance', 'Fixed Allowance', 'Gross Earnings', 'EPF Employee Contribution', 'Professional Tax', 'Income Tax', 'Net Pay']

export default {
  id: 'hr-payroll-zoho-payroll',
  version: '0.1.0',
  status: 'draft',
  verified: null,
  name: 'HR — mid-year payroll to Zoho Payroll',
  path: { source: 'Legacy payroll (mid-year)', target: 'Zoho Payroll (India)' },
  sources: [
    { what: 'Zoho Payroll (India) import field names: Employee Basic, Statutory and Payment Details', url: 'https://www.zoho.com/in/payroll/help/employer/import.html', read: '2026-11-09' },
    { what: 'Zoho Payroll (India) prior payroll: month-by-month pay information keyed by Employee ID, current financial year only', url: 'https://www.zoho.com/in/payroll/help/prior-payroll.html', read: '2026-11-09' },
    { what: 'Zoho Payroll built-in salary components (Basic, HRA, Fixed Allowance)', url: 'https://www.zoho.com/in/payroll/help/set-salary-components.html', read: '2026-11-09' },
    { what: 'Professional tax ceiling of ₹2,500 per person per year (Constitution Art. 276(2), as amended in 1988)', url: 'https://eparlib.nic.in/bitstream/123456789/614629/1/116375.pdf', read: '2026-11-09' },
  ],
  toConfirm: [
    'Column headers of the legacy payroll’s exports (employee master, monthly register, TDS summary): they differ by product; rename or map them to the ones here.',
    'Column headers of Zoho Payroll’s prior-payroll sample file, shown only in Configure Prior Payroll, and the component names in the client’s salary structure.',
    'Which Zoho Payroll report gives the prior payroll back after the import, and its headers.',
    'The date style of Zoho Payroll’s imports and exports (an organisation setting; DD/MM/YYYY assumed) and of the legacy exports.',
    'That both sides write the pay month as YYYY-MM, and the month a challan is for (not the month it was paid).',
    'Whether both sides round pay to whole rupees (the tolerance here is one paisa).',
    'greytHR: its import templates are not public, so this pack does not cover it; a greytHR variant needs a pilot’s sample files.',
  ],
  objects: [
    {
      id: 'employee-master',
      name: 'Employee master',
      guide: {
        export: 'From the legacy payroll, every employee paid in this financial year — leavers included — with code, name, joining date, location, PAN, UAN and bank details. Ask for a CSV or Excel export, not the PDF.',
        load: 'Zoho Payroll’s Complete Employee Basic Details import, as one file.',
        compare: 'After the import, export the employees from Zoho Payroll and reconcile them against the legacy list; headcount is compared by work location, so a location the two systems spell differently needs a crosswalk on that total.',
      },
      params: [{ id: 'cutoverDate', label: 'Cutover date — the first day Zoho Payroll pays for', type: 'date' }],
      columns: {
        load: ['Employee Number', 'First Name', 'Last Name', 'Date of Birth', 'Date of Joining', 'Work Location Name', 'Department', 'Designation', 'PAN Number', 'UAN Number', 'PF Account Number', 'Bank Name', 'Account Number', 'IFSC Code'],
        source: ['Emp Code', 'Employee Name', 'Date of Joining', 'Location', 'PAN', 'UAN', 'Bank A/c No', 'IFSC'],
        target: ['Employee Number', 'First Name', 'Last Name', 'Date of Joining', 'Work Location Name', 'PAN Number', 'UAN Number', 'Account Number', 'IFSC Code'],
      },
      formats: { load: ZOHO, source: LEGACY, target: ZOHO },
      contract: {
        name: 'Employees (Zoho Payroll)',
        rules: [
          notNull('Employee Number'),
          { kind: 'unique', column: 'Employee Number', op: 'unique' },
          notNull('First Name'),
          notNull('Date of Joining'),
          { kind: 'type', column: 'Date of Joining', op: '=', target: 'date' },
          { kind: 'comparison', column: 'Date of Joining', op: '<=', target: '{{cutoverDate}}' },
          notNull('Work Location Name'),
          // Zoho needs each work location set up before employees are imported.
          // Open its list of work locations as "locations".
          { kind: 'reference', column: 'Work Location Name', op: 'in', target: { file: 'locations', column: 'Work Location Name' } },
          { kind: 'identifier', column: 'PAN Number', op: 'is', target: 'pan' },
          // Without a PAN, TDS is deducted at the higher rate: a warning, not a block.
          notNull('PAN Number', { severity: 'warn' }),
          { kind: 'identifier', column: 'UAN Number', op: 'is', target: 'uan' },
          notNull('UAN Number', whenFilled('PF Account Number')),
          { kind: 'identifier', column: 'IFSC Code', op: 'is', target: 'ifsc' },
          notNull('IFSC Code', whenFilled('Account Number')),
        ],
      },
      spec: {
        key: { source: ['Emp Code'], target: ['Employee Number'], normalize: ['ignoreCase'] },
        mapping: [
          { source: 'Date of Joining', target: 'Date of Joining' },
          { source: 'Location', target: 'Work Location Name', ignoreCase: true },
          { source: 'PAN', target: 'PAN Number', ignoreCase: true },
          { source: 'UAN', target: 'UAN Number' },
          { source: 'Bank A/c No', target: 'Account Number' },
          { source: 'IFSC', target: 'IFSC Code', ignoreCase: true },
        ],
        totals: [{ fn: 'count', groupBy: { source: 'Location', target: 'Work Location Name' } }],
      },
      tags: {
        'Employee Name': 'personal', 'First Name': 'personal', 'Last Name': 'personal', 'Date of Birth': 'personal',
        PAN: 'identifier', 'PAN Number': 'identifier', UAN: 'identifier', 'UAN Number': 'identifier', 'PF Account Number': 'identifier',
        'Bank A/c No': 'identifier', 'Account Number': 'identifier',
      },
      scope: 'Employees paid in this financial year, one legal entity (one Zoho Payroll organisation) per run; headcount by work location. Addresses, salary structures and tax declarations are not compared.',
    },
    {
      id: 'prior-payroll',
      name: 'Prior-payroll register',
      guide: {
        export: 'From the legacy payroll, the salary register for every month of this financial year before the cutover, one row per employee per month, as CSV or Excel — not the PDF register.',
        load: 'The prior-payroll pay information for Zoho Payroll. Zoho takes one upload per month; check the months together as one file with a Pay Month column.',
        compare: 'After the import, export the prior payroll from Zoho Payroll and reconcile it month by month and as year-to-date totals per employee.',
      },
      columns: {
        load: ['Employee Number', 'Pay Month', ...REGISTER_COMPONENTS],
        source: ['Emp Code', 'Month', 'Gross', 'PF', 'PT', 'TDS', 'Net Pay'],
        target: ['Employee Number', 'Pay Month', 'Gross Earnings', 'EPF Employee Contribution', 'Professional Tax', 'Income Tax', 'Net Pay'],
      },
      formats: { load: ZOHO, source: LEGACY, target: ZOHO },
      contract: {
        name: 'Prior payroll (Zoho Payroll)',
        rules: [
          notNull('Employee Number'),
          notNull('Pay Month'),
          { kind: 'unique', column: 'Employee Number', op: 'unique', target: ['Pay Month'] },
          // Every employee paid must be in the employee master: open Zoho's
          // employee list (or the master load file) as "employees".
          { kind: 'reference', column: 'Employee Number', op: 'in', target: { file: 'employees', column: 'Employee Number' } },
          ...REGISTER_COMPONENTS.flatMap(amount),
          { kind: 'crossColumn', column: 'Basic', op: '<=', target: 'Gross Earnings', targetIsColumn: true },
          { kind: 'crossColumn', column: 'Net Pay', op: '<=', target: 'Gross Earnings', targetIsColumn: true },
          { kind: 'aggregate', column: 'Professional Tax', fn: 'sum', groupBy: 'Employee Number', op: '<=', target: String(PROFESSIONAL_TAX_CAP) },
        ],
      },
      spec: {
        key: { source: ['Emp Code', 'Month'], target: ['Employee Number', 'Pay Month'], normalize: ['ignoreCase'] },
        mapping: [
          { source: 'Gross', target: 'Gross Earnings', tolerance: 0.01 },
          { source: 'PF', target: 'EPF Employee Contribution', tolerance: 0.01 },
          { source: 'PT', target: 'Professional Tax', tolerance: 0.01 },
          { source: 'TDS', target: 'Income Tax', tolerance: 0.01 },
          { source: 'Net Pay', target: 'Net Pay', tolerance: 0.01 },
        ],
        // Year to date, per employee: what Form 16 and the PF and PT returns are built from.
        totals: [
          { source: 'Gross', target: 'Gross Earnings', groupBy: { source: 'Emp Code', target: 'Employee Number' } },
          { source: 'TDS', target: 'Income Tax', groupBy: { source: 'Emp Code', target: 'Employee Number' } },
          { source: 'PF', target: 'EPF Employee Contribution', groupBy: { source: 'Emp Code', target: 'Employee Number' } },
          { source: 'PT', target: 'Professional Tax', groupBy: { source: 'Emp Code', target: 'Employee Number' } },
        ],
      },
      tags: Object.fromEntries([...REGISTER_COMPONENTS, 'Gross', 'PF', 'PT', 'TDS'].map((column) => [column, 'pay'])),
      scope: 'Pay for each month of this financial year before the cutover, by employee — gross, employee EPF, professional tax, income tax and net pay — and their year-to-date totals. Employer contributions, arrears, reimbursements and investment declarations are not compared.',
    },
    {
      id: 'tds-deposits',
      name: 'TDS deposits',
      guide: {
        export: 'From the legacy payroll, the TDS deducted from salaries in each month of this financial year: one row per month.',
        load: 'Not a load: the challans are already paid. This object only proves that what was deducted was deposited.',
        compare: 'A file of the challans paid, one row per month the tax was deducted in (the month it is for, not the month it was paid), reconciled against the deductions.',
      },
      columns: {
        load: [],
        source: ['Month', 'TDS Deducted'],
        target: ['Month', 'Challan Serial No', 'BSR Code', 'Date of Deposit', 'Tax Deposited'],
      },
      formats: { source: LEGACY, target: LEGACY },
      contract: { name: 'TDS deposits', rules: [] },
      spec: {
        key: { source: ['Month'], target: ['Month'] },
        mapping: [{ source: 'TDS Deducted', target: 'Tax Deposited', tolerance: 0.01 }],
        totals: [{ source: 'TDS Deducted', target: 'Tax Deposited' }],
      },
      scope: 'Salary TDS (section 192) deducted in each month against the tax deposited for that month. Interest, late fees, Form 24Q returns and each challan’s status at TRACES are not checked.',
    },
  ],
}
