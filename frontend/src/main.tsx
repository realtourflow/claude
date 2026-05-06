import { StrictMode, Component, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';
import { AuthSetup } from './api/AuthSetup';
import './index.css';

// Catch any JS error and display it as text so we can see what's crashing
window.onerror = (_msg, _src, _line, _col, error) => {
  const root = document.getElementById('root');
  if (root && !root.innerHTML) {
    root.innerHTML = `<div style="padding:32px;font-family:monospace;color:red"><h2>Crash</h2><pre>${error?.stack ?? error ?? _msg}</pre></div>`;
  }
};
window.onunhandledrejection = (e) => {
  const root = document.getElementById('root');
  if (root && !root.innerHTML) {
    root.innerHTML = `<div style="padding:32px;font-family:monospace;color:red"><h2>Unhandled rejection</h2><pre>${e.reason}</pre></div>`;
  }
};

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace' }}>
          <h2 style={{ color: 'red' }}>React crash</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{(error as Error).stack ?? (error as Error).message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Auth0Provider
        domain={import.meta.env.VITE_AUTH0_DOMAIN}
        clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        }}
      >
        <AuthSetup>
          <App />
        </AuthSetup>
      </Auth0Provider>
    </ErrorBoundary>
  </StrictMode>,
);
