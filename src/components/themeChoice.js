// Light (Direction C), dark (Direction A, "Blueprint"), or whatever the
// system says. The choice is a per-device convenience, kept in this browser
// only; when it cannot be read or written the app simply follows the system.

export const THEME_CHOICES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

const KEY = 'plumbstep-theme'

export function readThemeChoice() {
  try {
    const value = window.localStorage.getItem(KEY)
    return THEME_CHOICES.some((c) => c.id === value) ? value : 'system'
  } catch {
    return 'system'
  }
}

// Sets data-theme on <html> (index.css reads it); "system" removes it, so the
// prefers-color-scheme rule decides.
export function applyThemeChoice(choice) {
  const root = document.documentElement
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice
  else delete root.dataset.theme
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, choice)
  } catch {
    // Storage refused (private window, blocked site data): the choice lasts
    // for this page only.
  }
}
