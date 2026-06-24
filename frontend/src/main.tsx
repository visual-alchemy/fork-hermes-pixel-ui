import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML = '<pre style="color:red;padding:20px;">FATAL: #root element not found</pre>'
  throw new Error('Root element not found')
}

try {
  const root = ReactDOM.createRoot(rootEl)
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
} catch (err) {
  rootEl.innerHTML = `<pre style="color:red;padding:20px;">FATAL: ${err instanceof Error ? err.message : String(err)}\n\n${err instanceof Error ? err.stack : ''}</pre>`
  throw err
}
