// Kept so existing pipelines and docs keep working: `dcv reconcile` is the command.
//   node scripts/reconcile.mjs <spec.json> <source.csv> <target.csv> [options]
import { main } from '../bin/dcv.mjs'

process.exit(await main(['reconcile', ...process.argv.slice(2)]))
