// A worked change check: a salary revision done by an outside payroll bureau,
// checked by the business against the contract its CA wrote. Every person,
// company and amount in it is invented.
//
// The contract: Basic and HRA may rise, by at most 20%, and only for the
// employees on the approved list; CTC must become its approved value; every
// other column must stay exactly as it was. The bureau's file breaks it twice:
//   - one employee's bank account changed (nothing allowed it) — Permitted fields;
//   - one approved employee's Basic rose 30% (the cap is 20%) — Limits.
// changeSample.test.js pins that story step by step.

export const CHANGE_SAMPLE = {
  name: 'FY27 salary revision',
  beforeName: 'payroll_before_revision.csv',
  afterName: 'payroll_after_revision.csv',
  approvedName: 'approved_revisions.csv',
  contractName: 'salary-revision.change.json',
}

const HEADER = 'Emp Code,Name,Bank Account,Grade,Basic,HRA,CTC'
const STAFF = [
  ['E101', 'Asha Rao', '50100012345678', 'M1', 50000, 20000, 900000],
  ['E102', 'Vikram Shah', '50100023456789', 'M2', 40000, 16000, 720000],
  ['E103', 'Meera Iyer', '50100034567890', 'M2', 38000, 15200, 684000],
  ['E104', 'Kabir Sen', '50100045678901', 'M3', 30000, 12000, 540000],
  ['E105', 'Farah Khan', '50100056789012', 'M3', 31000, 12400, 558000],
  ['E106', 'Rohan Das', '50100067890123', 'M1', 52000, 20800, 936000],
  ['E107', 'Nisha Pillai', '50100078901234', 'M2', 41000, 16400, 738000],
  ['E108', 'Arjun Mehta', '50100089012345', 'M3', 29000, 11600, 522000],
]

// The approved revisions: who, and the CTC each must end on.
const APPROVED = [
  ['E101', 990000],
  ['E102', 792000],
  ['E106', 1029600],
  ['E107', 811800],
]

// What the bureau's file holds after the revision.
const AFTER = {
  E101: { Basic: 55000, HRA: 22000, CTC: 990000 },
  E102: { Basic: 44000, HRA: 17600, CTC: 792000 },
  E103: { 'Bank Account': '50100099999999' }, // changed, and nothing allowed it
  E106: { Basic: 67600, HRA: 22880, CTC: 1029600 }, // Basic +30%: above the 20% cap
  E107: { Basic: 45100, HRA: 18040, CTC: 811800 },
}

const COLUMNS = HEADER.split(',')
const csv = (rows) => `${[HEADER, ...rows.map((r) => r.join(','))].join('\n')}\n`

export const changeBefore = csv(STAFF)
export const changeAfter = csv(STAFF.map((row) => {
  const patch = AFTER[row[0]] ?? {}
  return COLUMNS.map((column, i) => patch[column] ?? row[i])
}))
export const changeApproved = `Emp Code,CTC\n${APPROVED.map((r) => r.join(',')).join('\n')}\n`

export const changeContract = {
  name: CHANGE_SAMPLE.name,
  key: ['Emp Code'],
  approved: { key: ['Emp Code'] },
  fields: {
    Basic: { policy: 'bounded', direction: 'up', maxPercent: 20, onlyFor: 'approved' },
    HRA: { policy: 'bounded', direction: 'up', maxPercent: 20, onlyFor: 'approved' },
    CTC: { policy: 'asApproved' },
  },
}

// Which columns are sensitive: their values are masked in the record.
export const changeTags = { Name: 'personal', 'Bank Account': 'identifier', Basic: 'pay', HRA: 'pay', CTC: 'pay' }

// Who did what, as the record states it. The bureau made the change; the
// business exported both files and approved the list; its CA wrote the
// contract and ran the check — so the check is not self-checked.
export const changeCustody = {
  mover: 'Example Payroll Services (the bureau)',
  contract: { by: 'adviser', name: 'Example & Co, Chartered Accountants' },
  before: { by: 'business', name: 'HR operations', at: '2026-10-31' },
  after: { by: 'business', name: 'HR operations', at: '2026-11-07' },
  approved: { by: 'business', name: 'Head of HR' },
  ran: { by: 'adviser', name: 'Example & Co, Chartered Accountants' },
}
