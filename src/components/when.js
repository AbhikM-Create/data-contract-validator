// How long ago something was saved, as a person reads it.
// Recent saves are the ones you are working with, so they read in relative
// terms; older ones get a date, because "43 days ago" is not a useful fact.
export function when(iso) {
  if (!iso) return 'just now'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return 'recently'
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days <= 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toISOString().slice(0, 10)
}
