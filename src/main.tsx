import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class AppErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Football Auction League] render error:', error, info);
  }

  render() {
    if (this.state.error) {
      const message = this.state.error.message || 'Unknown runtime error';
      return (
        <div style={{
          minHeight: '100vh',
          background: '#020617',
          color: '#e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{
            width: '100%',
            maxWidth: 620,
            padding: 24,
            border: '1px solid rgba(244,63,94,.35)',
            borderRadius: 20,
            background: '#0f172a',
          }}>
            <div style={{ color: '#fb7185', fontWeight: 800, fontSize: 12, letterSpacing: 1.5 }}>
              APP RUNTIME ERROR
            </div>
            <h1 style={{ margin: '8px 0', fontSize: 22 }}>Football Auction League crashed</h1>
            <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
              The page is still running, but a UI component failed. Reload once; if it repeats,
              the error below tells us exactly where to look.
            </p>
            <pre style={{
              marginTop: 16,
              padding: 14,
              overflow: 'auto',
              borderRadius: 12,
              background: '#020617',
              color: '#fda4af',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}>{message}</pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                border: 0,
                borderRadius: 12,
                padding: '10px 16px',
                background: '#10b981',
                color: '#022c22',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
