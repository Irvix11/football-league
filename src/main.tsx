import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[app] React render error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#020617',
          color: '#e2e8f0',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ maxWidth: 560, width: '100%', border: '1px solid #334155', borderRadius: 16, padding: 20, background: '#0f172a' }}>
            <div style={{ color: '#fbbf24', fontWeight: 800, letterSpacing: '.08em', fontSize: 12 }}>FOOTBALL AUCTION LEAGUE</div>
            <h1 style={{ margin: '8px 0', fontSize: 24 }}>The game failed to render</h1>
            <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
              Reload the page. If this keeps happening, the error details below can be used to diagnose the deployment.
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#fda4af', fontSize: 12, overflow: 'auto' }}>
              {this.state.error.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, border: 0, background: '#34d399', color: '#020617', fontWeight: 800 }}
            >
              Reload game
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);