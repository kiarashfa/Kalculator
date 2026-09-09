import React from 'react'
import ReactDOM from 'react-dom/client'
import Kalculator from './Kalculator.jsx'
import './styles/fonts.css'

// Top-level error boundary: a bad render (e.g. a malformed AST state) would
// otherwise white-screen the whole app. Catch it and offer a Reset, which
// remounts Kalculator with fresh state (equivalent to AC + clear history).
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, key: 0 }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Kalculator crashed:', error, info); }
  reset = () => this.setState((s) => ({ error: null, key: s.key + 1 }));
  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0a0a0f', color: '#fff', fontFamily: "'DM Mono',monospace", padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 32, opacity: 0.4 }}>⚠</div>
          <div style={{ fontSize: 14, color: '#eee' }}>Something went wrong.</div>
          <div style={{ fontSize: 11, color: '#777', maxWidth: 320, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</div>
          <button onClick={this.reset} style={{ marginTop: 8, background: 'linear-gradient(135deg,#f472b6,#ec4899)', border: 'none', color: '#fff', borderRadius: 10, padding: '10px 24px', fontSize: 14, fontWeight: 600, fontFamily: "'DM Mono',monospace", cursor: 'pointer' }}>Reset (AC)</button>
        </div>
      );
    }
    return <Kalculator key={this.state.key} />;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary />
  </React.StrictMode>
)

// PWA: register the service worker for offline use. Production only, so it
// never interferes with the Vite dev server / HMR. BASE_URL keeps it correct
// under the GitHub Pages sub-path (/Kalculator/).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
  })
}
