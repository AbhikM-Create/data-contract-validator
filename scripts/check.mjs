// Kept so existing pipelines and docs keep working: `dcv check` is the command.
//   node scripts/check.mjs <contract.json> <load.csv> [options]
import { main } from '../bin/dcv.mjs'

process.exit(await main(['check', ...process.argv.slice(2)]))
