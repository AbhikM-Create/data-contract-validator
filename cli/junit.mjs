// JUnit XML, the format every CI system shows natively — Azure DevOps, Jenkins,
// GitLab, GitHub annotators. One test suite per check, one test case per step
// (reconciliation) or per rule (readiness).
//
// CI logs are read by many people, so this carries the finding's sentence and
// its counts — never an example record. The sentences name columns and counts;
// the records stay in the --json output, the evidence pack and the fix list.

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const x = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => XML[c])

function suite(name, cases, seconds, properties) {
  const failures = cases.filter((c) => c.failure).length
  const skipped = cases.filter((c) => c.skipped).length
  const props = Object.entries(properties)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `      <property name="${x(k)}" value="${x(v)}"/>`)
    .join('\n')
  const body = cases.map((c) => {
    const open = `    <testcase classname="${x(name)}" name="${x(c.name)}" time="0">`
    if (c.failure) return `${open}\n      <failure message="${x(c.failure.message)}" type="${x(c.failure.type)}">${x(c.failure.detail)}</failure>\n    </testcase>`
    if (c.skipped) return `${open}\n      <skipped message="${x(c.skipped)}"/>\n    </testcase>`
    return `${open}</testcase>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="data-contract-validator" tests="${cases.length}" failures="${failures}" skipped="${skipped}" time="${seconds.toFixed(3)}">
  <testsuite name="${x(name)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}" time="${seconds.toFixed(3)}">
    <properties>
${props}
    </properties>
${body}
  </testsuite>
</testsuites>
`
}

export function reconcileJunit(report, { seconds = 0, build, files } = {}) {
  const name = `reconcile: ${report.name ?? 'reconciliation'}`
  const props = { tool: build?.name, version: build?.version, commit: build?.commit, source: files?.source, target: files?.target, status: report.status }
  if (report.status === 'INVALID') {
    return suite(name, [{ name: 'spec', failure: { message: 'The spec cannot run against these files', type: 'INVALID', detail: report.issues.join('\n') } }], seconds, props)
  }
  const cases = report.steps.map((step, i) => ({
    name: `${i + 1} ${step.label} — ${step.question}`,
    ...(step.status === 'FAIL'
      ? { failure: { message: step.findings.map((f) => f.message).join(' '), type: step.findings.map((f) => f.code).join(','), detail: step.findings.map((f) => `${f.code}${f.column ? ` [${f.column}]` : ''}: ${f.message}`).join('\n') } }
      : step.status === 'SKIPPED' ? { skipped: step.reason ?? 'not configured' } : {}),
  }))
  return suite(name, cases, seconds, props)
}

export function readinessJunit(report, { seconds = 0, build, file } = {}) {
  const name = `readiness: ${report.name ?? 'contract'}`
  const props = { tool: build?.name, version: build?.version, commit: build?.commit, file, status: report.status }
  if (report.status === 'INVALID') {
    return suite(name, [{ name: 'contract', failure: { message: 'The check cannot run as set up', type: 'INVALID', detail: report.issues.join('\n') } }], seconds, props)
  }
  const cases = report.checks.map((check) => ({
    name: `${check.description}${check.severity === 'warn' ? ' (warning only)' : ''}`,
    // A warn rule that fails is reported, not failed: the target accepts the
    // record, so a pipeline gated on JUnit must not stop on it.
    ...(check.status === 'FAIL' && check.severity === 'reject'
      ? { failure: { message: `${check.failing} of ${check.applicable} records would be rejected`, type: 'REJECT', detail: check.description } }
      : check.status === 'FAIL'
        ? { skipped: `${check.failing} of ${check.applicable} records would load with a warning` }
        : check.status === 'UNCHECKED'
          ? { failure: { message: check.reason, type: 'UNCHECKED', detail: check.description } }
          : {}),
  }))
  return suite(name, cases, seconds, props)
}
