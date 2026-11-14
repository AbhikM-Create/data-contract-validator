import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'
import { applyThemeChoice, readThemeChoice } from './components/themeChoice.js'

// Before the first paint, so the page never flashes the other theme.
applyThemeChoice(readThemeChoice())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
