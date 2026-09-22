import { useCallback, useEffect, useRef, useState } from 'react'
import AppShell from './components/AppShell.jsx'
import { contractToJson, parseContractFile } from './lib/contractFile.js'
import { deleteContract, listContracts, loadContract, saveContract } from './lib/contractStore.js'
import { clearFileInWorker, parseFileInWorker, parseTextInWorker, validateInWorker } from './lib/engineClient.js'
import { summariseRun } from './lib/runRecord.js'
import { listRuns, saveRun } from './lib/runStore.js'
import { ruleKey } from './lib/rules.js'
import { DEFAULT_THRESHOLDS } from './lib/validate.js'
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
  const [contractId, setContractId] = useState(null)
  const [savedContracts, setSavedContracts] = useState([])
  const [contractsLoading, setContractsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runNotice, setRunNotice] = useState(null)
  const [runs, setRuns] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState(null)

  // Parsing and checking happen in a worker, which also KEEPS the parsed rows.
  // The main thread holds only summaries, so it never has a million row objects
  // in hand while trying to render — and re-checking after a threshold change
  // costs nothing, because the rows are already over there.
  const [draft, setDraft] = useState(null)
  const [contract, setContract] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(null)
  const [engineError, setEngineError] = useState(null)

  const loadFile = useCallback(async (which, file) => {
    const refusal = tooLargeToRead(file)
    if (refusal) {
      setEngineError(refusal)
      return
    }

    setEngineError(null)
    setBusy(`Reading ${file.name}…`)
    try {
      const { file: summary, draft: inferred } = await parseFileInWorker(which, file)
      if (which === 'baseline') {
        setBaseline(summary)
        setDraft(inferred)
      } else {
        setCandidate(summary)
      }
    } catch (error) {
      setEngineError(error.message)
    } finally {
      setBusy(null)
    }
  }, [])

  const clearFile = useCallback(async (which) => {
    if (which === 'baseline') {
      setBaseline(null)
      setDraft(null)
    } else {
      setCandidate(null)
    }
    await clearFileInWorker(which)
  }, [])

  // Re-check whenever an input to the check changes. The counter drops stale
  // answers: a slow check of a large file must not overwrite the faster one
  // somebody started after it.
  const checkId = useRef(0)

  // Synchronising with an external system — the worker — which is what effects
  // are for; the state it sets is the answer that comes back.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    if (!candidate || candidate.rowCount === 0 || (!draft && rules.length === 0)) {
      // oxlint-disable-next-line react/set-state-in-effect
      setResult(null)
      setContract(null)
      return
    }

    checkId.current += 1
    const mine = checkId.current
    setBusy('Checking…')

    validateInWorker({ rules, thresholds })
      .then(({ result: checked, contract: used }) => {
        if (mine !== checkId.current) return
        setResult(checked ?? null)
        setContract(used ?? null)
      })
      .catch((error) => {
        if (mine !== checkId.current) return
        setEngineError(error.message)
        setResult(null)
      })
      .finally(() => {
        if (mine === checkId.current) setBusy(null)
      })
  }, [candidate, draft, rules, thresholds])

  const addRule = (rule) => setRules((current) => (
    current.some((existing) => ruleKey(existing) === ruleKey(rule)) ? current : [...current, rule]
  ))
  const removeRule = (rule) => setRules((current) => current.filter((existing) => ruleKey(existing) !== ruleKey(rule)))

  const downloadContract = () => {
    const json = contractToJson({ name: contractName, rules })
    const safeName = (contractName.trim() || 'contract').replace(/[^\w.-]+/g, '-').toLowerCase()
    saveFile(`${safeName}.contract.json`, json, 'application/json')
    setContractNotice({ tone: 'good', text: `Saved ${rules.length} rule${rules.length === 1 ? '' : 's'} to ${safeName}.contract.json. Load it back here any time to check another file.` })
  }

  const loadContractFile = async (file) => {
    const loaded = parseContractFile(await file.text())
    if (loaded.error) {
      setContractNotice({ tone: 'bad', text: loaded.error })
      return
    }
    setRules(loaded.rules)
    setContractName(loaded.name)
    // A contract read from a file is not the saved row that happens to be open;
    // saving it should create a new one rather than overwrite something else.
    setContractId(null)
    setContractNotice(loaded.skipped.length > 0
      ? {
          tone: 'warn',
          text: `Loaded ${loaded.rules.length} rule${loaded.rules.length === 1 ? '' : 's'}, but ${loaded.skipped.length} could not be read and ${loaded.skipped.length === 1 ? 'is' : 'are'} NOT being checked.`,
          details: loaded.skipped.map((s) => `${s.rule?.column ?? '(no column)'}: ${s.reason}`),
        }
      : { tone: 'good', text: `Loaded "${loaded.name}" — ${loaded.rules.length} rule${loaded.rules.length === 1 ? '' : 's'}, now checked on every file you validate.` })
  }

  // --- saved contracts ------------------------------------------------------
  const refreshContracts = useCallback(async () => {
    if (!user) {
      setSavedContracts([])
      return
    }
    setContractsLoading(true)
    const { contracts, error } = await listContracts()
    setSavedContracts(contracts)
    setContractsLoading(false)
    if (error) setContractNotice({ tone: 'bad', text: error })
  }, [user])

  // Signing in or out changes whose contracts these are, so the list is rebuilt
  // rather than left showing the previous account's names. This is an effect
  // synchronising with an external system — the database — which is the case
  // the rule below exists to allow; the state it sets is the fetch result.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { refreshContracts() }, [refreshContracts])

  const saveToAccount = async () => {
    setSaving(true)
    const { contract: saved, error } = await saveContract({ id: contractId, name: contractName, rules })
    setSaving(false)
    if (error) {
      setContractNotice({ tone: 'bad', text: error })
      return
    }
    setContractId(saved.id)
    setContractName(saved.name)
    setContractNotice({ tone: 'good', text: `Saved "${saved.name}" to your account — ${rules.length} rule${rules.length === 1 ? '' : 's'}.` })
    refreshContracts()
  }

  const openFromAccount = async (id) => {
    const { contract: opened, skipped, error } = await loadContract(id)
    if (error) {
      setContractNotice({ tone: 'bad', text: error })
      return
    }
    setContractId(opened.id)
    setContractName(opened.name)
    setRules(opened.rules)
    setContractNotice(skipped.length > 0
      ? {
          tone: 'warn',
          text: `Opened "${opened.name}" with ${opened.rules.length} rule${opened.rules.length === 1 ? '' : 's'}, but ${skipped.length} could not be read and ${skipped.length === 1 ? 'is' : 'are'} NOT being checked.`,
          details: skipped.map((s) => `${s.rule?.column ?? '(no column)'}: ${s.reason}`),
        }
      : { tone: 'good', text: `Opened "${opened.name}" — ${opened.rules.length} rule${opened.rules.length === 1 ? '' : 's'}, now checked on every file you validate.` })
  }

  const removeFromAccount = async (id) => {
    const { error } = await deleteContract(id)
    if (error) {
      setContractNotice({ tone: 'bad', text: error })
      return
    }
    // The open contract no longer exists anywhere; keeping its id would make
    // the next save fail against a row that is gone.
    if (id === contractId) setContractId(null)
    setContractNotice({ tone: 'good', text: 'Contract deleted.' })
    refreshContracts()
  }

  const newContract = () => {
    setContractId(null)
    setContractName('')
    setRules([])
    setContractNotice(null)
  }

  // --- run history ----------------------------------------------------------
  // A run is recorded when a FILE IS CHECKED — not every time the result object
  // is recomputed. Adjusting a threshold afterwards re-judges what is on screen,
  // which is exploration; recording each drag of a number input would fill the
  // history with noise and bury the actual checks.
  const lastRunKey = useRef(null)

  const refreshRuns = useCallback(async () => {
    if (!user) {
      setRuns([])
      return
    }
    setRunsLoading(true)
    const { runs: rows, error } = await listRuns()
    setRuns(rows)
    setRunsError(error)
    setRunsLoading(false)
  }, [user])

  // Same as the contracts list: whose runs these are changes with the account.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { refreshRuns() }, [refreshRuns])

  useEffect(() => {
    if (!user || !result || !candidate) return
    const key = [candidate.name, candidate.rowCount, contractId ?? 'unsaved', rules.length, baseline?.name ?? ''].join('|')
    if (lastRunKey.current === key) return
    lastRunKey.current = key

    const record = summariseRun({
      result,
      contractId,
      contractName,
      baselineName: baseline?.name ?? null,
      candidateName: candidate.name,
      baselineRows: baseline?.rowCount ?? null,
      candidateRows: candidate.rowCount,
    })

    saveRun(record).then(({ error }) => {
      // The check already happened, in the browser, and is on screen. Failing
      // to record it is worth saying, never worth interrupting.
      setRunNotice(error ?? null)
      if (!error) refreshRuns()
    })
  }, [user, result, candidate, baseline, contractId, contractName, rules.length, refreshRuns])

  const loadSample = async (sample) => {
    setEngineError(null)
    setBusy('Loading the example…')
    go('validate')
    try {
      const base = await parseTextInWorker('baseline', sample.baseline(), sample.baselineName)
      setBaseline(base.file)
      setDraft(base.draft)
      const cand = await parseTextInWorker('candidate', sample.candidate(), sample.candidateName)
      setCandidate(cand.file)
    } catch (error) {
      setEngineError(error.message)
    } finally {
      setBusy(null)
    }
  }

  const reset = () => {
    setBaseline(null)
    setCandidate(null)
    setRules([])
    setContractName('')
    setContractNotice(null)
    setContractId(null)
  }

  return (
    <AppShell route={route} user={user} authLoading={authLoading} busy={busy} engineError={engineError} onDismissError={() => setEngineError(null)}>
      {route === 'home' && <LandingScreen onLoadSample={loadSample} />}

      {route === 'contracts' && (
        <ContractsScreen
          contract={draft}
          draft={draft}
          baseline={baseline}
          rules={rules}
          contractName={contractName}
          contractNotice={contractNotice}
          onName={setContractName}
          onLoadContract={loadContractFile}
          onSaveContract={saveToAccount}
          onOpenContract={openFromAccount}
          onDeleteContract={removeFromAccount}
          onNewContract={newContract}
          savedContracts={savedContracts}
          contractsLoading={contractsLoading}
          contractId={contractId}
          saving={saving}
          user={user}
          onDownloadContract={downloadContract}
          onLoadBaseline={(file) => loadFile('baseline', file)}
          onClearBaseline={() => clearFile('baseline')}
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
          onLoadBaseline={(file) => loadFile('baseline', file)}
          onLoadCandidate={(file) => loadFile('candidate', file)}
          onClearBaseline={() => clearFile('baseline')}
          onClearCandidate={() => clearFile('candidate')}
          onThresholdChange={(key, value) => setThresholds((current) => ({ ...current, [key]: value }))}
          onThresholdReset={() => setThresholds(DEFAULT_THRESHOLDS)}
          onReset={reset}
          onCheckAnother={() => clearFile('candidate')}
          onRemoveRule={removeRule}
          runNotice={runNotice}
        />
      )}

      {route === 'history' && (
        <HistoryScreen
          runs={runs}
          loading={runsLoading}
          error={runsError}
          signedIn={Boolean(user)}
          onRefresh={refreshRuns}
        />
      )}

      {route === 'signin' && <SignInScreen user={user} />}
    </AppShell>
  )
}

// Measured, not guessed. On a register-shaped CSV this engine costs roughly
// 2 KB of memory per row once the browser is done with it, so a 57 MB file
// needs about 1.3 GB and a 114 MB file about 2.1 GB — past what a tab can be
// relied on to survive. Refusing with a reason and a way forward beats a tab
// that dies holding someone's work.
const REFUSE_BYTES = 90 * 1024 * 1024

const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`

function tooLargeToRead(file) {
  if (file.size <= REFUSE_BYTES) return null
  return `"${file.name}" is ${mb(file.size)}, and a browser tab cannot hold a file that size — everything here runs in this page, so the limit is real memory, not a policy. Check a slice of it, or split it by month or region and check each part.`
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
