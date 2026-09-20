// Demo data. Not part of the engine — the engine never imports this.
//
// The CSVs are generated rather than checked in as fixtures for one reason: the
// freshness layer measures the newest row against NOW. A static file would read
// as stale a few days after it was written, and the "clean" pair would start
// failing a layer it is supposed to demonstrate passing. Generating from today's
// date keeps each sample demonstrating the break it is named for, and only that
// break. The generator is seeded, so the same day always produces the same file.

const DAY = 86_400_000
const COLUMNS = ['order_date', 'region', 'channel', 'order_count', 'revenue_usd', 'avg_basket_usd', 'returns']
const REGIONS = ['east', 'north', 'south', 'west']
const CHANNELS = ['partner', 'store', 'web']

function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

// One row per day, ending `endDaysAgo` days before today.
function buildRows({ seed, days, endDaysAgo, volumeDrift = 1 }) {
  const random = mulberry32(seed)
  const todayUtc = Math.floor(Date.now() / DAY) * DAY
  const rows = []

  for (let i = 0; i < days; i += 1) {
    const dayIndex = days - 1 - i
    const stamp = todayUtc - (endDaysAgo + dayIndex) * DAY
    const orderCount = Math.round((1150 + 180 * Math.sin(i / 6) + (random() - 0.5) * 240) * volumeDrift)
    const basket = 95 + 6 * Math.cos(i / 5) + (random() - 0.5) * 8
    const revenue = orderCount * basket
    rows.push({
      order_date: isoDay(stamp),
      region: REGIONS[Math.floor(random() * REGIONS.length)],
      channel: CHANNELS[Math.floor(random() * CHANNELS.length)],
      order_count: String(orderCount),
      revenue_usd: revenue.toFixed(2),
      avg_basket_usd: basket.toFixed(2),
      returns: String(Math.round(orderCount * (0.03 + random() * 0.015))),
    })
  }
  return rows
}

function toCsv(rows, columns) {
  const header = columns.join(',')
  const body = rows.map((row) => columns.map((name) => row[name] ?? '').join(','))
  return [header, ...body].join('\n')
}

const baselineRows = () => buildRows({ seed: 20260913, days: 45, endDaysAgo: 45 })
const candidateRows = () => buildRows({ seed: 771103, days: 45, endDaysAgo: 0, volumeDrift: 1.03 })

// The 83x case. Revenue alone is multiplied — the column still parses as a
// number, its nulls are unchanged, the categories and dates are untouched, and
// the multiple (83.4, with per-row jitter) is nowhere near a unit conversion.
// So schema, semantics and freshness all pass and only distribution objects.
function distributionBreak() {
  const random = mulberry32(4242)
  return candidateRows().map((row) => ({
    ...row,
    revenue_usd: (Number(row.revenue_usd) * 83.4 * (0.997 + random() * 0.006)).toFixed(2),
  }))
}

// A rename, a dropped column, a new column, and a numeric column rewritten as
// buckets — the breaks that stop a reader dead at the first gate.
function schemaBreak() {
  return candidateRows().map((row) => ({
    order_date: row.order_date,
    region: row.region,
    channel: row.channel,
    order_count: Number(row.order_count) > 1250 ? 'high' : Number(row.order_count) > 1050 ? 'medium' : 'low',
    revenue: row.revenue_usd,
    currency: 'USD',
    returns: row.returns,
  }))
}

const SCHEMA_BREAK_COLUMNS = ['order_date', 'region', 'channel', 'order_count', 'revenue', 'currency', 'returns']

export const SAMPLE_PAIRS = [
  {
    id: 'clean',
    name: 'Clean pair',
    expectation: 'nothing wrong — all four checks pass',
    blurb: 'Six weeks of orders, then the six weeks that followed. Same columns, same categories, up to date, and the numbers are the size they have always been.',
    baselineName: 'orders_baseline.csv',
    candidateName: 'orders_candidate_clean.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(candidateRows(), COLUMNS),
  },
  {
    id: 'distribution',
    name: 'Distribution break',
    expectation: 'only the last check catches it',
    blurb: 'Same columns, same categories, dates right up to today — but every revenue value arrives 83× too large. This is the kind of break a column-name check waves straight through.',
    baselineName: 'orders_baseline.csv',
    candidateName: 'orders_candidate_83x_revenue.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(distributionBreak(), COLUMNS),
  },
  {
    id: 'schema',
    name: 'Schema break',
    expectation: 'the very first check stops it',
    blurb: 'A column has been renamed, another has gone missing, a new one has appeared, and the order counts now arrive as "high"/"medium"/"low" instead of numbers.',
    baselineName: 'orders_baseline.csv',
    candidateName: 'orders_candidate_schema_drift.csv',
    baseline: () => toCsv(baselineRows(), COLUMNS),
    candidate: () => toCsv(schemaBreak(), SCHEMA_BREAK_COLUMNS),
  },
]
