import { useEffect, useState } from 'react'

// Hash routing, ~30 lines instead of a router dependency. The app is served as
// static files (an Artifact, a CDN, any static host), and a hash route needs no
// server rewrites to survive a refresh or a shared link.

export const ROUTES = [
  { id: 'contracts', label: 'Contracts', blurb: 'Author the rules a file must obey' },
  { id: 'validate', label: 'Validate', blurb: 'Check a file and read the result' },
  { id: 'history', label: 'History', blurb: 'Runs you have saved' },
]

const IDS = new Set([...ROUTES.map((route) => route.id), 'home'])

function readHash() {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].trim()
  return IDS.has(raw) ? raw : 'home'
}

export function useRoute() {
  const [route, setRoute] = useState(readHash)

  useEffect(() => {
    const onChange = () => setRoute(readHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

// Navigating writes the hash and lets the listener update state, so the back
// button and a pasted link behave identically to a click.
export function go(id) {
  window.location.hash = id === 'home' ? '/' : `/${id}`
  window.scrollTo({ top: 0 })
}
