import ContractSummary from '../components/ContractSummary.jsx'
import LayerCard from '../components/LayerCard.jsx'
import RuleResults, { ResultTile } from '../components/RuleResults.jsx'
import Staircase from '../components/Staircase.jsx'
import Thresholds from '../components/Thresholds.jsx'
import UploadCard from '../components/UploadCard.jsx'
import { go } from '../routes.js'
import { chip, colors, ghostButton, mono, panel, sans, secondaryButton } from '../theme.js'

// Run a check and read the result. The staircase leads, because which step the
// file fell on is the finding; the detail underneath is for acting on it.
export default function ValidateScreen({
  baseline, candidate, contract, result, rules, thresholds, draft,
  onLoadBaseline, onLoadCandidate, onClearBaseline, onClearCandidate,
  onThresholdChange, onThresholdReset, onReset, onCheckAnother, onRemoveRule, runNotice,
}) {
  if (result) {
    return (
      <Report
        baseline={baseline}
        candidate={candidate}
        contract={contract}
        result={result}
        rules={rules}
        thresholds={thresholds}
        onThresholdChange={onThresholdChange}
        onThresholdReset={onThresholdReset}
        onReset={onReset}
        onCheckAnother={onCheckAnother}
        onRemoveRule={onRemoveRule}
        runNotice={runNotice}
      />
    )
  }

  return (
    <>
      <ScreenHead
        title="Validate a file"
        blurb="Check a CSV against a baseline you trust, against the rules you have written, or both."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 20 }}>
        <UploadCard
          step={1}
          title="The file you trust"
          tag="baseline"
          hint={rules.length > 0
            ? 'Optional — you already have rules loaded. Add a baseline to also compare the two files.'
            : 'A known-good CSV. Its shape becomes the expectation the new file is measured against.'}
          accent={colors.accent}
          file={baseline}
          onFile={onLoadBaseline}
          onClear={onClearBaseline}
        />
        <UploadCard
          step={2}
          title="The file to check"
          tag="new file"
          hint="The CSV that just arrived, and that you want to check before using it."
          accent={colors.warn}
          file={candidate}
          onFile={onLoadCandidate}
          onClear={onClearCandidate}
        />
      </div>

      <StatusLine baseline={baseline} candidate={candidate} contract={draft} hasRules={rules.length > 0} />

      <div style={{ ...panel, padding: '14px 16px', marginTop: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: colors.ink }}>
            {rules.length > 0
              ? `${rules.length} rule${rules.length === 1 ? '' : 's'} will be checked alongside the comparison`
              : 'No rules loaded'}
          </div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: colors.mute, marginTop: 3 }}>
            {rules.length > 0
              ? 'Rules are checked on the new file directly, whether or not a baseline is loaded.'
              : 'Rules state what the data must be — legal values, dates that must follow each other.'}
          </div>
        </div>
        <button onClick={() => go('contracts')} style={secondaryButton}>
          {rules.length > 0 ? 'Edit contract' : 'Write rules'}
        </button>
      </div>
    </>
  )
}

function Report({
  baseline, candidate, contract, result, rules, thresholds,
  onThresholdChange, onThresholdReset, onReset, onCheckAnother, onRemoveRule, runNotice,
}) {
  // The comparison half shows drift only. A layer that failed purely because of
  // an authored rule reads PASS here and FAIL in the rules section — which is
  // the truth: nothing drifted, a requirement was broken.
  const baselineLayers = result.layers.map((layer) => {
    const violations = layer.violations.filter((violation) => violation.source !== 'rule')
    const status = layer.note && violations.length === 0 ? 'SKIPPED' : violations.length > 0 ? 'FAIL' : 'PASS'
    return { ...layer, violations, status }
  })

  const leadLayer = baselineLayers.find((layer) => layer.status === 'FAIL')

  return (
    <>
      <div style={{ ...panel, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {baseline && (
          <>
            <FileChip tone={colors.accent} caption="baseline" name={baseline.name} rows={baseline.rowCount} />
            <span style={{ color: colors.faint, fontFamily: sans, fontSize: 12 }}>vs</span>
          </>
        )}
        <FileChip tone={colors.warn} caption="checked" name={candidate.name} rows={candidate.rowCount} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onCheckAnother} style={ghostButton}>check another file</button>
          <button onClick={onReset} style={ghostButton}>start over</button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <span style={chip(result.status === 'PASS' ? 'PASS' : result.status === 'FAIL' ? 'FAIL' : 'INSUFFICIENT')}>
          {result.status === 'PASS' ? 'ALL CHECKS PASSED' : result.status === 'FAIL' ? 'PROBLEM FOUND' : 'CANNOT CHECK'}
        </span>
        <h1 style={{ fontFamily: sans, fontSize: 24, fontWeight: 650, color: colors.ink, letterSpacing: '-0.015em', margin: '10px 0 0', maxWidth: 760, lineHeight: 1.25 }}>
          {result.headline.text}
        </h1>
        {result.headline.detail && (
          <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.6, margin: '10px 0 0', maxWidth: 760 }}>
            {result.headline.detail}
          </p>
        )}
      </div>

      {/* The check itself already happened, in this browser, and is on screen.
          Failing to record it is worth saying and never worth interrupting. */}
      {runNotice && (
        <p style={{ fontFamily: sans, fontSize: 12.5, color: colors.warn, lineHeight: 1.5, marginTop: 12 }}>
          {runNotice} The result above is still correct — only the history entry is missing.
        </p>
      )}

      {baseline && <Staircase layers={baselineLayers} />}

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <ResultTile
          title="Rules you set"
          subtitle="what you declared must be true"
          status={ruleStatus(result, rules)}
          detail={ruleDetail(result, rules)}
        />
        <ResultTile
          title="Compared with the baseline"
          subtitle="what changed since the file you trust"
          status={baseline ? (result.baselineViolations.length > 0 ? 'FAIL' : 'PASS') : 'NOT RUN'}
          detail={baseline
            ? `${result.baselineViolations.length || 'No'} difference${result.baselineViolations.length === 1 ? '' : 's'} from ${baseline.name}`
            : 'No baseline loaded'}
        />
      </div>

      {rules.length > 0 && (
        <Section title="Rules you set" blurb="Requirements you stated, checked on the new file directly.">
          <RuleResults outcomes={result.rules} onRemove={onRemoveRule} />
        </Section>
      )}

      <Section
        title="Compared with the file you trust"
        blurb={baseline
          ? 'The detail behind each step above.'
          : 'This check needs a baseline. Load one and the four checks run alongside your rules.'}
      >
        {baseline && baselineLayers.map((layer, index) => (
          <LayerCard key={layer.id} layer={layer} index={index} isLead={leadLayer?.id === layer.id} />
        ))}
      </Section>

      {baseline && <ContractSummary contract={contract} />}

      {result.status !== 'INSUFFICIENT' && baseline && (
        <Thresholds values={thresholds} onChange={onThresholdChange} onReset={onThresholdReset} />
      )}
    </>
  )
}

export function ScreenHead({ title, blurb, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontFamily: sans, fontSize: 22, fontWeight: 650, color: colors.ink, letterSpacing: '-0.015em', margin: 0 }}>
          {title}
        </h1>
        <p style={{ fontFamily: sans, fontSize: 14, color: colors.mute, lineHeight: 1.55, margin: '7px 0 0', maxWidth: 680 }}>
          {blurb}
        </p>
      </div>
      {action}
    </div>
  )
}

export function Section({ title, blurb, children }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: colors.ink, margin: 0 }}>{title}</h2>
      {blurb && (
        <p style={{ fontFamily: sans, fontSize: 13, color: colors.mute, lineHeight: 1.5, margin: '6px 0 0', maxWidth: 680 }}>{blurb}</p>
      )}
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  )
}

function FileChip({ tone, caption, name, rows }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: mono, fontSize: 12.5, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: colors.faint }}>
          {caption} &middot; {rows.toLocaleString('en-US')} rows
        </div>
      </div>
    </div>
  )
}

function StatusLine({ baseline, candidate, contract, hasRules }) {
  const unreadable = [baseline, candidate].some((file) => file && file.rowCount === 0)
  let tone = colors.faint
  let text = 'Add a file to each slot above, or load just one if you are checking against rules alone.'

  if (unreadable) {
    tone = colors.fail
    text = 'One of the files could not be read — the reason is on its panel above.'
  } else if (contract && !contract.sufficient) {
    tone = colors.warn
    text = `${capitalise(contract.insufficientReason)}. A range measured over a handful of rows describes the handful, not the feed.`
  } else if (baseline && !candidate) {
    text = 'Now add the file you want to check.'
  } else if (!baseline && candidate) {
    text = hasRules
      ? 'Your rules are being checked on this file. Add a baseline to also compare the two.'
      : 'Add a file you trust, or write rules on the Contracts screen.'
  } else if (hasRules) {
    text = 'A contract is loaded. Add the file you want to check — a baseline is optional.'
  }

  return <p style={{ fontFamily: sans, fontSize: 12.5, color: tone, lineHeight: 1.5, marginTop: 14 }}>{text}</p>
}

function ruleStatus(result, rules) {
  if (rules.length === 0) return 'NOT SET'
  if (result.rules.some((outcome) => outcome.status === 'FAIL')) return 'FAIL'
  if (result.rules.some((outcome) => outcome.status === 'UNCHECKED')) return 'UNCHECKED'
  return 'PASS'
}

function ruleDetail(result, rules) {
  if (rules.length === 0) return 'No rules declared'
  const broken = result.rules.filter((outcome) => outcome.status === 'FAIL').length
  return broken === 0
    ? `All ${rules.length} rule${rules.length === 1 ? '' : 's'} held`
    : `${broken} of ${rules.length} rule${rules.length === 1 ? '' : 's'} broken`
}

function capitalise(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}
