// The "how to re-run this" line an evidence pack prints. An auditor copies it
// into a terminal, so it must name the command people actually have — `dcv`,
// from the npm package or the container — and survive file names with spaces.
//
// Quoting is POSIX (bash, zsh, Git Bash, CI runners). An argument made only of
// safe characters is left bare, which also reads correctly in PowerShell and
// cmd; anything else is single-quoted, which PowerShell reads the same way
// unless the name itself contains a single quote.

const SAFE = /^[\w@%+=:,./-]+$/

export function shellArg(value) {
  const text = String(value)
  if (text !== '' && SAFE.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

// dcvCommand('check', ['a.json', 'load file.csv', '--key', 'id']) -> "dcv check a.json 'load file.csv' --key id"
export const dcvCommand = (subcommand, args) => ['dcv', subcommand, ...args].map(shellArg).join(' ')

// The workspace's re-run block: one line per check included in the pack.
//   objectFile   the migration object as saved from the workspace
//   load         the load file's name, when readiness is included
//   source/target the extracts' names, when reconciliation is included
//   key          the target key columns readiness used
//   references    { name: fileName } for reference rules
export function workspaceReproduce({ objectFile, load, source, target, key = [], references = {} }) {
  const lines = []
  const refs = Object.entries(references).sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, file]) => ['--reference', `${name}=${file}`])
  if (load) lines.push(dcvCommand('check', [objectFile, load, ...(key.length ? ['--key', key.join(',')] : []), ...refs]))
  if (source && target) lines.push(dcvCommand('reconcile', [objectFile, source, target]))
  if (lines.length === 0) return null
  return [`# with ${objectFile} saved from the workspace, in the folder that holds the files`, ...lines].join('\n')
}
