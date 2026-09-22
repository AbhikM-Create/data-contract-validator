// Contract inference. Pure: no DOM, no React, no file handling.
//
// A "contract" is what the baseline file implies the data is SUPPOSED to look
// like: its columns, their types, the value domains of its categoricals, the
// numeric ranges, and how often it updates. validate.js checks a candidate
// against this object and nothing else, so the same contract can be inferred
// once and reused against many candidates.

export const TYPES = {
  NUMERIC: 'numeric',
  DATE: 'date',
  BOOLEAN: 'boolean',
  CATEGORICAL: 'categorical',
  TEXT: 'text',
  EMPTY: 'empty',
}

// Minimum baseline rows before an inferred contract means anything. Below this,
// "the range" and "the cadence" are noise, and a validator that reports a
// confident PASS/FAIL off 3 rows is worse than one that admits it can't tell.
export const MIN_BASELINE_ROWS = 8

const CURRENCY_RE = /\p{Sc}/gu
const PERCENT_RE = /%/g
const THOUSANDS_RE = /,/g
const BOOL_TRUE = new Set(['true', 'yes', 'y', 't'])
const BOOL_FALSE = new Set(['false', 'no', 'n', 'f'])

// Dates must LOOK like dates (separators, or an ISO timestamp) — a bare integer
// such as 20260913 or 1757 stays numeric. Otherwise every id column in the world
// gets read as a date and the freshness layer starts inventing cadences.
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  /^\d{4}\/\d{2}\/\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}([T ]\d{1,2}:\d{2}(:\d{2})?)?$/,
]

export function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

export function parseNumber(raw) {
  if (isBlank(raw)) return null
  const cleaned = String(raw).trim().replace(CURRENCY_RE, '').replace(PERCENT_RE, '').replace(THOUSANDS_RE, '').trim()
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export function parseDate(raw) {
  if (isBlank(raw)) return null
  const text = String(raw).trim()
  if (!DATE_PATTERNS.some((pattern) => pattern.test(text))) return null
  // A bare YYYY-MM-DD is parsed by JS as UTC midnight; the slash forms are parsed
  // as local. Normalising to UTC keeps a cadence from wobbling by a timezone
  // offset when a file mixes the two.
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text)
  return Number.isNaN(ms) ? null : ms
}

export function parseBoolean(raw) {
  if (isBlank(raw)) return null
  const text = String(raw).trim().toLowerCase()
  if (BOOL_TRUE.has(text)) return true
  if (BOOL_FALSE.has(text)) return false
  return null
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower)
}

export function columnNames(rows) {
  const seen = []
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!seen.includes(name)) seen.push(name)
    }
  }
  return seen
}

// One pass over the column, parsing each value at most once and keeping what
// came back. The three parsers are mutually exclusive — a date needs separators
// so it can never parse as a number, and no boolean word parses as either — so
// counting them in a single loop gives exactly the counts three separate passes
// gave, for a third of the parsing.
function scanTypes(present) {
  const dates = []
  const numbers = []
  let booleans = 0

  for (const raw of present) {
    const date = parseDate(raw)
    if (date !== null) {
      dates.push(date)
      continue
    }
    const number = parseNumber(raw)
    if (number !== null) {
      numbers.push(number)
      continue
    }
    if (parseBoolean(raw) !== null) booleans += 1
  }

  return { dates, numbers, booleans }
}

// 0.95 rather than 1.0: one "N/A" in a column of 500 dates is a typo, not a
// different type. Below that the column really is mixed, and calling it numeric
// would make every downstream statistic a lie.
function decideType(present, scan) {
  if (present.length === 0) return TYPES.EMPTY

  if (scan.dates.length / present.length >= 0.95) return TYPES.DATE
  if (scan.numbers.length / present.length >= 0.95) return TYPES.NUMERIC
  if (scan.booleans / present.length >= 0.95) return TYPES.BOOLEAN

  // Only reached when the column is none of the above: building a set of every
  // distinct value is the expensive path, and a numeric column never pays it.
  const distinct = new Set(present.map((v) => String(v).trim())).size
  const isCategorical = distinct < present.length && distinct <= Math.max(12, present.length * 0.05)
  return isCategorical ? TYPES.CATEGORICAL : TYPES.TEXT
}

// Profiles one column: its type plus whatever statistics that type supports.
// Both sides of a comparison are profiled with this same function, so the
// candidate is never measured with a different ruler than the baseline.
export function profileColumn(name, values) {
  const present = values.filter((v) => !isBlank(v))
  const nullRate = values.length === 0 ? 0 : 1 - present.length / values.length
  const scan = scanTypes(present)
  const type = decideType(present, scan)
  const profile = { name, type, rowCount: values.length, presentCount: present.length, nullRate }

  if (type === TYPES.NUMERIC) {
    const numbers = scan.numbers
    const sorted = [...numbers].sort((a, b) => a - b)
    const sum = numbers.reduce((acc, n) => acc + n, 0)
    profile.min = sorted[0] ?? null
    profile.max = sorted[sorted.length - 1] ?? null
    profile.mean = numbers.length ? sum / numbers.length : null
    profile.median = quantile(sorted, 0.5)
    profile.p05 = quantile(sorted, 0.05)
    profile.p95 = quantile(sorted, 0.95)
    profile.allIntegers = numbers.every((n) => Number.isInteger(n))
    // Kept because the candidate side needs every value to count how many fall
    // outside the baseline's range. inferContract drops it from the contract,
    // which is the long-lived object.
    profile.values = numbers
  }

  if (type === TYPES.DATE) {
    const stamps = scan.dates.sort((a, b) => a - b)
    profile.oldest = stamps[0] ?? null
    profile.newest = stamps[stamps.length - 1] ?? null
    profile.cadenceMs = medianCadence(stamps)
    profile.cadenceSpread = cadenceSpread(stamps)
    // The stamps themselves are deliberately NOT kept: every question asked of
    // them is answered above, and on a million-row file the array is the single
    // largest thing the profile would hold.
  }

  if (type === TYPES.CATEGORICAL || type === TYPES.BOOLEAN) {
    const counts = new Map()
    for (const value of present) {
      const key = String(value).trim()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    profile.domain = [...counts.keys()].sort()
    profile.counts = counts
  }

  return profile
}

// The typical gap between consecutive distinct timestamps. Median, not mean, so
// one backfill gap or one duplicated day doesn't redefine "daily" as "weekly".
function medianCadence(sortedStamps) {
  const distinct = [...new Set(sortedStamps)]
  if (distinct.length < 2) return null
  const gaps = []
  for (let i = 1; i < distinct.length; i += 1) gaps.push(distinct[i] - distinct[i - 1])
  gaps.sort((a, b) => a - b)
  return quantile(gaps, 0.5)
}

// How regular those gaps are: the interquartile range over the median.
//
// A median gap alone cannot tell a SCHEDULE from a series of EVENTS, and only a
// schedule implies anything about when the next row should arrive. This is what
// separates them. A feed that runs daily has gaps that barely vary and scores 0;
// a column of business dates scatters — hire dates 17 to 472 days apart score
// around 0.7.
//
// Interquartile range rather than min/max, so one backfill or one quiet summer
// cannot on its own make a regular feed look irregular.
function cadenceSpread(sortedStamps) {
  const distinct = [...new Set(sortedStamps)]
  // Under four gaps there are no quartiles worth the name.
  if (distinct.length < 5) return null

  const gaps = []
  for (let i = 1; i < distinct.length; i += 1) gaps.push(distinct[i] - distinct[i - 1])
  gaps.sort((a, b) => a - b)

  const median = quantile(gaps, 0.5)
  if (!median) return null
  return (quantile(gaps, 0.75) - quantile(gaps, 0.25)) / median
}

const CADENCE_UNITS = [
  { ms: 1000, one: 'about every second', many: (n) => `about every ${n} seconds` },
  { ms: 60_000, one: 'about every minute', many: (n) => `about every ${n} minutes` },
  { ms: 3_600_000, one: 'hourly', many: (n) => `about every ${n} hours` },
  { ms: 86_400_000, one: 'daily', many: (n) => `about every ${n} days` },
]

export function describeCadence(cadenceMs) {
  if (!cadenceMs || cadenceMs <= 0) return 'unknown'
  if (cadenceMs >= 86_400_000 * 6.5 && cadenceMs <= 86_400_000 * 7.5) return 'weekly'
  if (cadenceMs >= 86_400_000 * 28 && cadenceMs <= 86_400_000 * 31) return 'monthly'
  for (const unit of CADENCE_UNITS) {
    if (cadenceMs < unit.ms * 1.5) {
      const n = Math.max(1, Math.round(cadenceMs / unit.ms))
      return n === 1 ? unit.one : unit.many(n)
    }
  }
  const days = Math.round(cadenceMs / 86_400_000)
  return `about every ${days} days`
}

export function formatDate(ms) {
  if (ms === null || ms === undefined) return '—'
  const date = new Date(ms)
  const iso = date.toISOString()
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ')
}

// inferContract(baselineRows) -> contract
//
// `rows` is an array of plain objects (one per data row), exactly what a header
// CSV parse produces. Returns a contract even when the baseline is too small to
// trust — with sufficient:false and a reason — so callers can report
// INSUFFICIENT rather than render nothing.
export function inferContract(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const names = options.columns ?? columnNames(safeRows)
  const columns = names.map((name) => profileColumn(name, safeRows.map((row) => row[name])))

  // When several columns are dates, the one with the widest span is the one the
  // feed is actually keyed on (an event date beats a static "created_on").
  const dateColumns = columns.filter((c) => c.type === TYPES.DATE && c.newest !== null)
  const dateColumn = dateColumns.sort((a, b) => (b.newest - b.oldest) - (a.newest - a.oldest))[0] ?? null

  const reasons = []
  if (safeRows.length === 0) reasons.push('the baseline file has no data rows')
  else if (safeRows.length < MIN_BASELINE_ROWS) {
    reasons.push(
      `the baseline has only ${safeRows.length} row${safeRows.length === 1 ? '' : 's'} — ` +
        `at least ${MIN_BASELINE_ROWS} are needed before a range or a cadence means anything`,
    )
  }
  if (names.length === 0) reasons.push('the baseline file has no columns')

  // A contract keeps the SUMMARY of each numeric column, never the values
  // themselves. Every question the checks ask of the baseline is answered by
  // min, max, mean, median and the percentiles; only the candidate side needs
  // the raw numbers, and that profile is rebuilt for each file and thrown away.
  // On a million-row file this is the difference between a contract weighing
  // megabytes and weighing almost nothing.
  const stored = columns.map(({ values: _values, ...summary }) => summary)

  return {
    rowCount: safeRows.length,
    columns: stored,
    // A draft contract carries an empty rules[] so an authored contract and an
    // inferred one are the same shape — the engine never asks which it got.
    rules: options.rules ?? [],
    columnNames: names,
    byName: new Map(stored.map((column) => [column.name, column])),
    dateColumn: dateColumn ? dateColumn.name : null,
    cadenceMs: dateColumn ? dateColumn.cadenceMs : null,
    cadenceSpread: dateColumn ? dateColumn.cadenceSpread : null,
    newest: dateColumn ? dateColumn.newest : null,
    oldest: dateColumn ? dateColumn.oldest : null,
    sufficient: reasons.length === 0,
    insufficientReason: reasons[0] ?? null,
  }
}
