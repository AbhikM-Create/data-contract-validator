// Argument parsing shared by every command. Strict: an option this version does
// not know is refused, never ignored — a mistyped --evidnce that silently wrote
// no evidence pack is the kind of quiet failure this tool exists to prevent.

import { parseArgs } from 'node:util'

export class UsageError extends Error {}

export function parse(argv, { usage, positionals: count, options }) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: { help: { type: 'boolean', short: 'h' }, ...options }, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError(`${error.message.replace(/\. To specify.*$/s, '')}\n\nUsage: ${usage}`)
  }
  if (parsed.values.help) return { help: true }
  // `positionals` is an exact count, or { min } for a command taking a list.
  const min = typeof count === 'object' ? count.min : count
  if (typeof count === 'object' ? parsed.positionals.length < min : parsed.positionals.length !== count) {
    const wanted = typeof count === 'object' ? `at least ${min}` : String(count)
    throw new UsageError(`Expected ${wanted} file argument${min === 1 && typeof count !== 'object' ? '' : 's'}, got ${parsed.positionals.length}.\n\nUsage: ${usage}`)
  }
  const partitions = parsed.values.partitions === undefined ? undefined : Number(parsed.values.partitions)
  if (partitions !== undefined && !(Number.isInteger(partitions) && partitions >= 1 && partitions <= 256)) {
    throw new UsageError('--partitions must be a whole number from 1 to 256')
  }
  return { args: parsed.positionals, values: { ...parsed.values, partitions } }
}

// Exit codes are the contract with a pipeline, the same for every command:
export const EXIT = {
  OK: 0, // passed / ready
  FOUND: 1, // a check failed / records would be rejected
  UNUSABLE: 2, // could not be completed: bad input, bad spec, could not confirm
}
