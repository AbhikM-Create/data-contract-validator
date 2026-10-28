import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCsv } from './parseCsv.js'
import { checkReadiness } from './readiness.js'
import { cockpitProposals, fieldListProposals, readMigrationCockpitTemplate, readSpreadsheetXml } from './templates.js'

// Constructed from SAP's published description of the layout — see the comment
// at the top of the fixture. Not a template downloaded from an SAP system.
const COCKPIT = readFileSync(new URL('./__fixtures__/templates/cockpit-constructed.xml', import.meta.url), 'utf8')
const WITHOUT_FIELD_LIST = COCKPIT.replace(/<Worksheet ss:Name="Field List">[\s\S]*?<\/Worksheet>/, '')
const rules = (proposals) => proposals.map((p) => p.rule)

describe('XML Spreadsheet 2003', () => {
  it('keeps every cell in its column — skipped indexes, merged cells — and drops comments', () => {
    const { sheets, error } = readSpreadsheetXml(COCKPIT)
    expect(error).toBeNull()
    expect(sheets.map((s) => s.name)).toEqual(['Introduction', 'Field List', 'General Data'])
    const data = sheets[2].rows
    expect(data[2]).toEqual(['Key & Name', '', 'Other'])
    expect(data[7][1]).toBe('Name 1*')
    expect(JSON.stringify(sheets)).not.toMatch(/Legal name as registered/)
    expect(sheets[1].rows[1]).toEqual([]) // row 2 is absent: ss:Index="3" skipped it
  })

  it('refuses what is not one', () => {
    expect(readSpreadsheetXml('employee_id,name\n1,Ada').error).toBe('this is not a Microsoft XML Spreadsheet 2003 file')
    expect(readMigrationCockpitTemplate('<?mso-application progid="Excel.Sheet"?><Workbook><Worksheet ss:Name="X"><Table><Row><Cell><Data>hello</Data></Cell></Row></Table></Worksheet></Workbook>').error)
      .toMatch(/^no field list was found/)
  })
})

describe('an SAP Migration Cockpit template', () => {
  it('reads the Field List: mandatory, conditional, types and lengths', () => {
    const { structures, error } = readMigrationCockpitTemplate(COCKPIT)
    expect(error).toBeNull()
    expect(structures.map((s) => [s.sheet, s.structure, s.fields.length])).toEqual([['General Data', 'S_CUST_GEN', 5]])
    const { proposals, notImported } = cockpitProposals(structures[0])
    expect(rules(proposals)).toEqual([
      { kind: 'nullRule', column: 'KUNNR', op: 'notNull' },
      { kind: 'nullRule', column: 'NAME1', op: 'notNull' },
      { kind: 'type', column: 'ERDAT', op: '=', target: 'date' },
      { kind: 'type', column: 'UMSAT', op: '=', target: 'numeric' },
    ])
    expect(proposals[0].evidence).toBe('sheet “General Data”, KUNNR (Customer Number) is marked mandatory (Mandatory for sheet)')
    expect(notImported).toContainEqual({ column: 'LAND1', what: 'importance “Mandatory if address is given”', reason: 'it depends on other fields or sheets, which a rule cannot express exactly' })
    expect(notImported).toContainEqual({ column: 'NAME1', what: 'length 35', reason: 'this tool has no length rule' })
  })

  it('without a Field List, reads the structure sheet itself — and agrees with it', () => {
    const { structures } = readMigrationCockpitTemplate(WITHOUT_FIELD_LIST)
    expect(structures[0].fields.map((f) => [f.field, f.description, f.mandatory])).toEqual([
      ['KUNNR', 'Customer Number', true], ['NAME1', 'Name 1', true], ['LAND1', 'Country', false], ['ERDAT', 'Created On', false], ['UMSAT', 'Annual Sales', false],
    ])
    expect(rules(cockpitProposals(structures[0]).proposals)).toEqual(rules(cockpitProposals(readMigrationCockpitTemplate(COCKPIT).structures[0]).proposals))
  })

  it('names columns the way the load file does: technical names, or the descriptions', () => {
    const { structures } = readMigrationCockpitTemplate(COCKPIT)
    expect(rules(cockpitProposals(structures[0], { naming: 'description' }).proposals).map((r) => r.column)).toEqual(['Customer Number', 'Name 1', 'Created On', 'Annual Sales'])
  })

  it('the proposed rules predict what the target would refuse in a load file', () => {
    const contract = { rules: rules(cockpitProposals(readMigrationCockpitTemplate(COCKPIT).structures[0]).proposals) }
    const load = parseCsv('KUNNR,NAME1,LAND1,ERDAT,UMSAT\n100001,Northwind Traders,US,2026-01-15,125000.50\n100002,,DE,2026-02-01,9000\n100003,Contoso,,15/03/2026,abc\n')
    const report = checkReadiness(contract, load.rows, { columns: load.columns, key: ['KUNNR'] })
    expect(report.status).toBe('NOT_READY')
    expect(report.counts).toMatchObject({ records: 3, rejected: 2, clean: 1 })
  })
})

describe('a field list as CSV', () => {
  const csv = parseCsv([
    'Field name,Required,Data type,Allowed values,Min,Max,Max length',
    'employee_id,Yes,Text,,,,10',
    'hire_date,Y,Date,,,,',
    'grade,No,Text,Associate;Analyst;Senior Analyst,,,',
    'annual_salary,yes,Decimal,,0,500000,',
    'country,N,Text,"US, DE",,,',
    'notes,maybe,Memo,,,,',
  ].join('\n'))

  it('proposes what it can check exactly, and lists the rest with the reason', () => {
    const { proposals, notImported, error } = fieldListProposals(csv.rows, csv.columns)
    expect(error).toBeNull()
    expect(rules(proposals)).toEqual([
      { kind: 'nullRule', column: 'employee_id', op: 'notNull' },
      { kind: 'nullRule', column: 'hire_date', op: 'notNull' },
      { kind: 'type', column: 'hire_date', op: '=', target: 'date' },
      { kind: 'valueSet', column: 'grade', op: 'in', target: ['Associate', 'Analyst', 'Senior Analyst'] },
      { kind: 'nullRule', column: 'annual_salary', op: 'notNull' },
      { kind: 'type', column: 'annual_salary', op: '=', target: 'numeric' },
      { kind: 'range', column: 'annual_salary', op: 'between', target: [0, 500000] },
    ])
    expect(proposals[3].evidence).toBe('line 4, grade: allowed values')
    expect(notImported).toEqual([
      { column: 'employee_id', what: 'length 10', reason: 'this tool has no length rule' },
      { column: 'country', what: 'allowed values', reason: 'separate them with ; or | — a comma can be part of a value' },
      { column: 'notes', what: 'Required “maybe”', reason: 'not a yes or no' },
      { column: 'notes', what: 'type “Memo”', reason: 'not a type this tool reads (number, date, boolean, text)' },
    ])
  })

  it('refuses a file that names no fields, or says nothing checkable about them', () => {
    expect(fieldListProposals([{ a: 1 }], ['a']).error).toMatch(/^no column names the fields/)
    expect(fieldListProposals([{ Field: 'x', Notes: 'y' }], ['Field', 'Notes']).error).toMatch(/^no column says anything a rule can check/)
  })
})
