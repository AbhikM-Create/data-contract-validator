import { useCallback, useMemo, useState } from 'react'
import AppShell from './components/AppShell.jsx'
import { defineContract, withRules } from './lib/authoredContract.js'
import { inferContract } from './lib/contract.js'
import { contractToJson, parseContractFile } from './lib/contractFile.js'
import { parseCsv, parseCsvFile } from './lib/parseCsv.js'
import { ruleKey } from './lib/rules.js'
import { DEFAULT_THRESHOLDS, validate } from './lib/validate.js'
import { useAuth } from './lib/useAuth.js'
import { go, useRoute } from './routes.js'
import ContractsScreen from './screens/ContractsScreen.jsx'
import HistoryScreen from './screens/HistoryScreen.jsx'
import LandingScreen from './screens/LandingScreen.jsx'
import SignInScreen from './screens/SignInScreen.jsx'
import ValidateScreen from './screens/ValidateScreen.jsx'

// The shell owns the session: the contract being authored and the files being
// checked. Screens are views onto it, so a contract written on Contracts is
// already loaded when you arrive at Validate.
export default function App() {
  const route = useRoute()
  const { user, loading: authLoading } = useAuth()

  const [baseline, setBaseline] = useState(null)
  const [candidate, setCandidate] = useState(null)
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS)
  const [rules, setRules] = useState([])
  const [contractName, setContractName] = useState('')
  const [contractNotice, setContractNotice] = useState(null)

  const draft = useMemo(
    () => (baseline && baseline.rows.length > 0 ? inferContract(baseline.rows) : null),
    [baseline],
  )

  // Draft plus authored rules. With no rules it is the v1 contract exactly;
  // with rules and no baseline it stands on its own, which is what lets a saved
  // contract judge files it was never drafted from.
  const contract = useMemo(() => {
    if (draft) return withRules(draft, rules)
    if (rules.length > 0) return defineContract({ rules, name: contractName || null })
    return null
  }, [draft, rules, contractName])

  const result = useMemo(
    () => (contract && candidate && candidate.rows.length > 0 ? validate(contract, candidate.rows, { thresholds }) : null),
    [contract, candidate, thresholds],
  )

  const addRule = (rule) => setRules((current) => (
    current.some((existing) => ruleKey(existing) === ruleKey(rule)) ? current : [...current, rule]
  ))
  const removeRule = (rule) => setRules((current) => current.filter((existing) => ruleKey(existing) !== ruleKey(rule)))

  const loadFile = useCallback(async (file, setter) => {
    setter(await parseCsvFile(file))
  }, [])

  const downloadContract = () => {
    const json = contractToJson({ name: contractName, rules })
    const safeName = (contractName.trim() || 'contract').replace(/[^\w.-]+/g, '-').toLowerCase()
    saveFile(`${safeName}.contract.json`, json, 'application/json')
    setContractNotice({ tone: 'good', text: `Saved ${rules.length} rule${rules.length === 1 ? '' : 's'} to ${safeName}.contract.json. Load it back here any time to check another file.` })
  }

  const loadContract = async (file) => {
    const loaded = parseContractFile(await file.text())
    if (loaded.error) {
      setContractNotice({ tone: 'bad', text: loaded.error })
      return
    }
    setRules(loaded.rules)
    setContractName(loaded.name)
    setContractNotice(loaded.skipped.length > 0
      ? {
          tone: 'warn',
          text: `Loaded ${loaded.rules.length} rule${loaded.rules.length === 1 ? '' : 's'}, but ${loaded.skipped.length} could not be read and ${loaded.skipped.length === 1 ? 'is' : 'are'} NOT being checked.`,
          details: loaded.skipped.map((s) => `${s.rule?.column ?? '(no column)'}: ${s.reason}`),
        }
      : { tone: 'good', text: `Loaded "${loaded.name}" — ${loaded.rules.length} rule${loaded.rules.length === 1 ? '' : 's'}, now checked on every file you validate.` })
  }

  const loadSample = (sample) => {
    setBaseline({ ...parseCsv(sample.baseline()), name: sample.baselineName })
    setCandidate({ ...parseCsv(sample.candidate()), name: sample.candidateName })
    go('validate')
  }

  const reset = () => {
    setBaseline(null)
    setCandidate(null)
    setRules([])
    setContractName('')
    setContractNotice(null)
  }

  return (
    <AppShell route={route} user={user} authLoading={authLoading}>
      {route === 'home' && <LandingScreen onLoadSample={loadSample} />}

      {route === 'contracts' && (
        <ContractsScreen
          contract={contract}
          draft={draft}
          baseline={baseline}
          rules={rules}
          contractName={contractName}
          contractNotice={contractNotice}
          onName={setContractName}
          onLoadContract={loadContract}
          onDownloadContract={downloadContract}
          onLoadBaseline={(file) => loadFile(file, setBaseline)}
          onClearBaseline={() => setBaseline(null)}
          onAddRule={addRule}
          onRemoveRule={removeRule}
          onClearRules={() => setRules([])}
        />
      )}

      {route === 'validate' && (
        <ValidateScreen
          baseline={baseline}
          candidate={candidate}
          contract={contract}
          draft={draft}
          result={result}
          rules={rules}
          thresholds={thresholds}
          onLoadBaseline={(file) => loadFile(file, setBaseline)}
          onLoadCandidate={(file) => loadFile(file, setCandidate)}
          onClearBaseline={() => setBaseline(null)}
          onClearCandidate={() => setCandidate(null)}
          onThresholdChange={(key, value) => setThresholds((current) => ({ ...current, [key]: value }))}
          onThresholdReset={() => setThresholds(DEFAULT_THRESHOLDS)}
          onReset={reset}
          onCheckAnother={() => setCandidate(null)}
          onRemoveRule={removeRule}
        />
      )}

      {route === 'history' && <HistoryScreen />}

      {route === 'signin' && <SignInScreen user={user} />}
    </AppShell>
  )
}

// Everything this app hands back is built in the page and handed straight to
// the browser — there is no server to ask for a file.
function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
