// The engine, running off the main thread.
//
// Parsing and checking a large file is seconds of unbroken CPU work. On the
// main thread that is seconds where the page cannot paint, scroll, or respond
// to a click — the tab simply appears to have crashed, and on a big enough file
// it actually does. Here, the page stays alive and can say what is happening.
//
// The worker also OWNS the parsed rows. They are the largest thing in the
// system — about 2 KB per row once V8 is done with them — and keeping them here
// means the main thread never holds a million row objects while trying to
// render. It also means re-checking after a threshold change costs nothing: the
// rows are already parsed.

import { inferContract } from './contract.js'
import { parseCsv } from './parseCsv.js'
import { defineContract, withRules } from './authoredContract.js'
import { validate } from './validate.js'

const files = { baseline: null, candidate: null }

// A profile carries every value of every numeric column. The main thread only
// ever displays summaries, so the arrays are stripped before crossing — sending
// them would undo the point of keeping the rows over here.
function summarise(file) {
  if (!file) return null
  return {
    name: file.name,
    rowCount: file.rows.length,
    columns: file.columns,
    errors: file.errors,
  }
}

function lightContract(contract) {
  if (!contract) return null
  return {
    ...contract,
    columns: contract.columns.map(({ values: _values, counts: _counts, ...rest }) => rest),
    byName: undefined,
  }
}

function handle(message) {
  const { type } = message

  if (type === 'parse') {
    const { which, text, name } = message
    const parsed = parseCsv(text)
    files[which] = { ...parsed, name }

    const draft = which === 'baseline' && parsed.rows.length > 0 ? inferContract(parsed.rows) : null
    return { file: summarise(files[which]), draft: lightContract(draft) }
  }

  if (type === 'clear') {
    files[message.which] = null
    return { file: null, draft: null }
  }

  if (type === 'validate') {
    const { rules, thresholds } = message
    const baseline = files.baseline
    const candidate = files.candidate

    if (!candidate || candidate.rows.length === 0) return { result: null }

    const draft = baseline && baseline.rows.length > 0 ? inferContract(baseline.rows) : null
    const contract = draft
      ? withRules(draft, rules)
      : rules.length > 0
        ? defineContract({ rules })
        : null

    if (!contract) return { result: null }

    const result = validate(contract, candidate.rows, { thresholds })

    // The result holds no rows, but it does hold rule objects and violation
    // strings, all of which clone cleanly.
    return { result, contract: lightContract(contract) }
  }

  return {}
}

self.onmessage = (event) => {
  const { id, ...message } = event.data
  try {
    self.postMessage({ id, ok: true, ...handle(message) })
  } catch (error) {
    // A worker that dies silently looks exactly like a slow one. Anything that
    // goes wrong comes back as an answer, so the page can say so.
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) })
  }
}
