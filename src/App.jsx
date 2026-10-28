import { useCallback, useEffect, useRef, useState } from 'react'
import AppShell from './components/AppShell.jsx'
import { contractToJson, parseContractFile } from './lib/contractFile.js'
import { deleteContract, listContracts, loadContract, saveContract } from './lib/contractStore.js'
import {
  clearFileInWorker, fixListInWorker, parseBytesInWorker, parseFileInWorker, parseTextInWorker, readinessInWorker, reconcileInWorker, validateInWorker,
} from './lib/engineClient.js'
import { createEvidencePack } from './lib/evidencePack.js'
import { findingTable } from './lib/findingTable.js'
import { sha256Hex } from './lib/hashing.js'
import {
  migrationObjectToJson, newMigrationObject, parseMigrationObjectFile, readCrosswalk, runnableContract, runnableSpec, summariseReadiness, summariseReconciliation,
} from './lib/migrationObject.js'
import { parseCsv, toCsv } from './lib/parseCsv.js'
import { summariseRun } from './lib/runRecord.js'
import { listRuns, saveRun } from './lib/runStore.js'
import { ruleKey } from './lib/rules.js'
import { DEFAULT_THRESHOLDS } from './lib/validate.js'
import { useAuth } from './lib/useAuth.js'
import { go, useRoute } from './routes.js'
import ContractsScreen from './screens/ContractsScreen.jsx'
import HistoryScreen from './screens/HistoryScreen.jsx'
import LandingScreen from './screens/LandingScreen.jsx'
import MigrationsScreen from './screens/MigrationsScreen.jsx'
import { MIGRATION_SAMPLE, migrationLoadFile, migrationSampleObject, migrationSource, migrationTarget } from './samples/migrationSample.js'
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

  // The migration workspace. The object is session state like the contract, so
  // moving between Contracts and Migrations loses nothing. A report remembers
  // what it was run against, so the page can say when it no longer matches.
  const [migration, setMigration] = useState(() => newMigrationObject(''))
  const [migrationDirty, setMigrationDirty] = useState(false)
  const [migrationNotice, setMigrationNotice] = useState(null)
  const [migrationFiles, setMigrationFiles] = useState({ load: null, source: null, target: null })
  const [recon, setRecon] = useState(null)
  const [readiness, setReadiness] = useState(null)

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

  // --- migration workspace -------------------------------------------------
  const changeMigration = (patch) => {
    setMigration((current) => ({ ...current, ...patch }))
    setMigrationDirty(true)
  }

  const fileStamp = (file) => (file ? `${file.name}|${file.rowCount}` : '')
  const reconStamp = (object, files) => JSON.stringify([runnableSpec(object), fileStamp(files.source), fileStamp(files.target)])
  const readinessStamp = (object, files) => JSON.stringify([runnableContract(object), object.spec.key.target, fileStamp(files.load)])

  // The File behind each role is kept, so declaring a different encoding can
  // read the same file again without asking for it twice.
  const migrationFileRefs = useRef({})

  const loadMigrationFile = async (which, file, encoding = migration.formats?.[which]?.encoding) => {
    migrationFileRefs.current[which] = file
    const refusal = tooLargeToRead(file)
    if (refusal) {
      setEngineError(`${refusal} The CLIs have no such limit: node scripts/reconcile.mjs and scripts/check.mjs stream files of any size.`)
      return
    }
    setEngineError(null)
    setBusy(`Reading ${file.name}…`)
    try {
      // Read once. Fingerprinted from the BYTES, before any decoding, so the
      // evidence pack's SHA-256 is the one `sha256sum` gives for this file;
      // decoded in the encoding declared for it.
      const bytes = await file.arrayBuffer()
      const [{ file: summary }, sha256] = await Promise.all([parseBytesInWorker(which, bytes, file.name, encoding), sha256Hex(bytes)])
      setMigrationFiles((current) => ({ ...current, [which]: { ...summary, sha256, bytes: file.size } }))
    } catch (error) {
      setEngineError(/UTF-8/.test(error.message)
        ? `${error.message} Choose it under the file, in “Read this file as”, and it is read again.`
        : error.message)
    } finally {
      setBusy(null)
    }
  }

  // A declared format is part of the object. Changing an encoding re-reads the
  // file in it; changing number or date notation needs no re-read — it is
  // applied when a check runs, and the report says it is out of date.
  const changeFormat = (role, format) => {
    const previous = migration.formats?.[role] ?? {}
    changeMigration({ formats: { ...(migration.formats ?? {}), [role]: format } })
    const file = migrationFileRefs.current[role]
    if (file && (previous.encoding ?? 'utf-8') !== (format.encoding ?? 'utf-8')) loadMigrationFile(role, file, format.encoding)
  }

  const clearMigrationFile = async (which) => {
    delete migrationFileRefs.current[which]
    setMigrationFiles((current) => ({ ...current, [which]: null }))
    if (which === 'load') setReadiness(null)
    else setRecon(null)
    await clearFileInWorker(which)
  }

  // A check that ran is recorded in the object — counts and verdicts only —
  // so the history travels with the file.
  const record = (run) => {
    if (!run) return
    setMigration((current) => ({ ...current, runs: [...current.runs, run] }))
    setMigrationDirty(true)
  }

  const runReconciliation = async () => {
    setBusy('Reconciling…')
    try {
      const { report } = await reconcileInWorker(runnableSpec(migration))
      if (!report) return
      setRecon({ report, stamp: reconStamp(migration, migrationFiles) })
      record(summariseReconciliation(report, {
        wave: migration.wave, cycle: migration.cycle, sourceName: migrationFiles.source?.name, targetName: migrationFiles.target?.name,
      }))
    } catch (error) {
      setEngineError(error.message)
    } finally {
      setBusy(null)
    }
  }

  const runReadiness = async () => {
    setBusy('Checking the load file…')
    try {
      const { report } = await readinessInWorker({ contract: runnableContract(migration), key: migration.spec.key.target.filter(Boolean) })
      if (!report) return
      setReadiness({ report, stamp: readinessStamp(migration, migrationFiles) })
      record(summariseReadiness(report, { wave: migration.wave, cycle: migration.cycle, fileName: migrationFiles.load?.name }))
    } catch (error) {
      setEngineError(error.message)
    } finally {
      setBusy(null)
    }
  }

  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const slug = (name, fallback) => (name.trim() || fallback).replace(/[^\w.-]+/g, '-').toLowerCase()

  const downloadFixList = async () => {
    const { csv } = await fixListInWorker()
    if (csv) saveFile(`${slug(migration.name, 'load')}-fix-list.csv`, csv, 'text/csv')
  }

  const exportFinding = (finding) => {
    const table = findingTable(finding, recon?.report)
    if (!table) return
    saveFile(`${slug(migration.name, 'reconciliation')}-${finding.code}${finding.column ? `-${finding.column}` : ''}.csv`, toCsv(table.columns, table.rows), 'text/csv')
  }

  const downloadMigration = () => {
    saveFile(`${slug(migration.name, 'migration')}.migration.json`, migrationObjectToJson(migration), 'application/json')
    setMigrationDirty(false)
    setMigrationNotice({ tone: 'good', text: `Saved to ${slug(migration.name, 'migration')}.migration.json — rules, mapping spec and ${migration.runs.length} check${migration.runs.length === 1 ? '' : 's'}. Open it here next cycle, or hand it to the CLIs.` })
  }

  const openMigration = async (file) => {
    const opened = parseMigrationObjectFile(await file.text())
    if (opened.error) {
      setMigrationNotice({ tone: 'bad', text: opened.error })
      return
    }
    setMigration(opened.object)
    setMigrationDirty(false)
    setRecon(null)
    setReadiness(null)
    setMigrationNotice(opened.skipped.length > 0
      ? {
          tone: 'warn',
          text: `Opened "${opened.object.name}", but ${opened.skipped.length} rule${opened.skipped.length === 1 ? '' : 's'} could not be read and ${opened.skipped.length === 1 ? 'is' : 'are'} NOT being checked.`,
          details: opened.skipped.map((entry) => `${entry.rule?.column ?? '(no column)'}: ${entry.reason}`),
        }
      : { tone: 'good', text: `Opened "${opened.object.name}" — ${count(opened.object.contract.rules.length, 'rule')}, ${count(opened.object.spec.mapping.length, 'mapped field')}, ${count(opened.object.runs.length, 'earlier check')}.` })
  }

  const newMigration = () => {
    setMigration(newMigrationObject(''))
    setMigrationDirty(false)
    setMigrationNotice(null)
    setRecon(null)
    setReadiness(null)
  }

  const loadMigrationSample = async () => {
    setEngineError(null)
    setBusy('Opening the example migration…')
    try {
      const parts = [
        ['source', migrationSource(), MIGRATION_SAMPLE.sourceName],
        ['target', migrationTarget(), MIGRATION_SAMPLE.targetName],
        ['load', migrationLoadFile(), MIGRATION_SAMPLE.loadName],
      ]
      const loaded = {}
      for (const [which, text, name] of parts) {
        const { file } = await parseTextInWorker(which, text, name)
        loaded[which] = { ...file, sha256: await sha256Hex(text), bytes: new TextEncoder().encode(text).length }
      }
      setMigrationFiles(loaded)
      setMigration(migrationSampleObject())
      setMigrationDirty(false)
      setRecon(null)
      setReadiness(null)
      setMigrationNotice({ tone: 'good', text: 'Example opened: an invented employee migration in Wave 1, Mock 2. Every person in it is made up. Check the load file, then reconcile.' })
    } catch (error) {
      setEngineError(error.message)
    } finally {
      setBusy(null)
    }
  }

  // A crosswalk is read in the page like every file, and refused — with every
  // reason — rather than half-applied.
  const applyCrosswalk = async (where, file) => {
    const read = readCrosswalk(parseCsv(await file.text()))
    if (!read.map) {
      setMigrationNotice({ tone: 'bad', text: `Couldn’t use ${file.name} as a crosswalk.`, details: read.issues })
      return
    }
    const spec = migration.spec
    const next = 'field' in where
      ? { ...spec, mapping: spec.mapping.map((f, i) => (i === where.field ? { ...f, map: read.map } : f)) }
      : { ...spec, totals: spec.totals.map((t, i) => (i === where.total ? { ...t, groupBy: { ...t.groupBy, map: read.map } } : t)) }
    changeMigration({ spec: next })
    setMigrationNotice({
      tone: read.issues.length ? 'warn' : 'good',
      text: `Crosswalk from ${file.name}: ${read.entries} legacy value${read.entries === 1 ? '' : 's'}.`,
      details: read.issues,
    })
  }

  // The evidence pack includes only checks whose results still match the
  // files and definitions on screen: a pack must never attest to files that
  // were not the ones checked.
  const downloadEvidence = async () => {
    const reconCurrent = recon && recon.stamp === reconStamp(migration, migrationFiles)
    const readyCurrent = readiness && readiness.stamp === readinessStamp(migration, migrationFiles)
    if (!reconCurrent && !readyCurrent) return
    const asFile = (f) => ({ name: f.name, rows: f.rowCount, bytes: f.bytes, sha256: f.sha256 })
    const objectFile = `${slug(migration.name, 'migration')}.migration.json`
    const key = migration.spec.key.target.filter(Boolean)
    const commands = [
      readyCurrent && `node scripts/check.mjs ${objectFile} ${migrationFiles.load.name}${key.length ? ` --key ${key.join(',')}` : ''}`,
      reconCurrent && `node scripts/reconcile.mjs ${objectFile} ${migrationFiles.source.name} ${migrationFiles.target.name}`,
    ].filter(Boolean)
    setBusy('Building the evidence pack…')
    try {
      const pack = await createEvidencePack({
        object: migration,
        readiness: readyCurrent ? { report: readiness.report, flaggedCount: readiness.report.flaggedCount, file: asFile(migrationFiles.load) } : null,
        reconciliation: reconCurrent ? { report: recon.report, source: asFile(migrationFiles.source), target: asFile(migrationFiles.target) } : null,
        generatedBy: 'the workspace',
        reproduce: `# with ${objectFile} saved from the workspace\n${commands.join('\n')}`,
      })
      saveFile(pack.fileName, pack.html, 'text/html')
      const left = [!readyCurrent && readiness && 'load readiness', !reconCurrent && recon && 'reconciliation'].filter(Boolean)
      setMigrationNotice({
        tone: left.length ? 'warn' : 'good',
        text: `Evidence pack ${pack.reference} saved as ${pack.fileName}.${left.length ? ` It leaves out ${left.join(' and ')}, whose result no longer matches the files and definitions on screen — run it again to include it.` : ''}`,
      })
    } catch (error) {
      setEngineError(error.message)
    } finally {
      setBusy(null)
    }
  }

  const useSessionRules = () => {
    changeMigration({ contract: { name: contractName || migration.contract.name, rules } })
    setMigrationNotice({ tone: 'good', text: `Now using the ${rules.length} rule${rules.length === 1 ? '' : 's'} open on Contracts for this object.` })
  }

  const editRulesOnContracts = () => {
    setRules(migration.contract.rules)
    setContractName(migration.contract.name || migration.name)
    setContractId(null)
    setContractNotice({ tone: 'good', text: `Editing the rules of the migration object "${migration.name || 'untitled'}". When you are done, go back to Migrations and choose “Use the rules open on Contracts”.` })
    go('contracts')
  }

  const loadContractIntoMigration = async (file) => {
    const loaded = parseContractFile(await file.text())
    if (loaded.error) {
      setMigrationNotice({ tone: 'bad', text: loaded.error })
      return
    }
    // A contract that declares how its files are written sets the load file's
    // format: the declaration travels with the rules it was written for.
    changeMigration({
      contract: { name: loaded.name, rules: loaded.rules },
      ...(loaded.format ? { formats: { ...(migration.formats ?? {}), load: loaded.format } } : {}),
    })
    setMigrationNotice(loaded.skipped.length > 0
      ? { tone: 'warn', text: `Loaded ${loaded.rules.length} rule${loaded.rules.length === 1 ? '' : 's'} from "${loaded.name}", but ${loaded.skipped.length} could not be read and ${loaded.skipped.length === 1 ? 'is' : 'are'} NOT being checked.`, details: loaded.skipped.map((entry) => `${entry.rule?.column ?? '(no column)'}: ${entry.reason}`) }
      : { tone: 'good', text: `Loaded ${loaded.rules.length} rule${loaded.rules.length === 1 ? '' : 's'} from "${loaded.name}".` })
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

      {route === 'migrations' && (
        <MigrationsScreen
          object={migration}
          dirty={migrationDirty}
          notice={migrationNotice}
          files={migrationFiles}
          recon={recon && { report: recon.report, stale: recon.stamp !== reconStamp(migration, migrationFiles) }}
          readiness={readiness && { report: readiness.report, stale: readiness.stamp !== readinessStamp(migration, migrationFiles) }}
          sessionRules={rules}
          onChange={changeMigration}
          onOpenFile={openMigration}
          onDownload={downloadMigration}
          onNew={newMigration}
          onSample={loadMigrationSample}
          onLoadFile={loadMigrationFile}
          onClearFile={clearMigrationFile}
          onCrosswalk={applyCrosswalk}
          onReconcile={runReconciliation}
          onCheckReadiness={runReadiness}
          onDownloadFixList={downloadFixList}
          onExportFinding={exportFinding}
          onUseSessionRules={useSessionRules}
          onEditRules={editRulesOnContracts}
          onLoadContract={loadContractIntoMigration}
          onDownloadEvidence={downloadEvidence}
          onFormat={changeFormat}
        />
      )}

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
