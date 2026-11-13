import { useEffect, useState } from 'react'

// Hash routing, ~30 lines instead of a router dependency. The app is served as
// static files (an Artifact, a CDN, any static host), and a hash route needs no
// server rewrites to survive a refresh or a shared link.

// The bar (brand guideline, 13 Nov 2026): the two jobs people come for are
// primary; the rest sit in a quieter row. Route ids are unchanged, so every
// link still works. "Compare" joins the primary row when quick compare exists.
export const ROUTES = [
  { id: 'migrations', label: 'Projects', primary: true, blurb: 'Check a migration object before and after each load, and sign it off' },
  { id: 'validate', label: 'Monitor', primary: true, blurb: 'Check a feed against a file you trust, after go-live' },
  { id: 'contracts', label: 'Contracts', blurb: 'Author the rules a file must obey' },
  { id: 'history', label: 'History', blurb: 'Runs you have saved' },
  { id: 'organisation', label: 'Organisation', blurb: 'The people who share your migration objects, and their roles' },
]

// Reachable but not a destination: signing in is something you do on the way to
// somewhere else, so it gets a URL without taking a place in the nav.
const IDS = new Set([...ROUTES.map((route) => route.id), 'home', 'signin'])

const segments = () => window.location.hash.replace(/^#\/?/, '').split('?')[0].trim().split('/')

function readHash() {
  const raw = segments()[0]
  return IDS.has(raw) ? raw : 'home'
}

// The part after the screen — "#/migrations/before" -> "before" — so a step of
// the workspace has a link, and the back button moves between steps.
const readSub = () => segments()[1] ?? ''

export function useSubRoute() {
  const [sub, setSub] = useState(readSub)
  useEffect(() => {
    const onChange = () => setSub(readSub())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return sub
}

export function goSub(id, sub) {
  window.location.hash = sub ? `/${id}/${sub}` : `/${id}`
  window.scrollTo({ top: 0 })
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
