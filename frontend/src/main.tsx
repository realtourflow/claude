import { createRoot } from 'react-dom/client';

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;

createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 32, fontFamily: 'monospace', fontSize: 16 }}>
    <h2>RealTourFlow — env check</h2>
    <p>AUTH0_DOMAIN: <b>{domain ?? 'MISSING'}</b></p>
    <p>AUTH0_CLIENT_ID: <b>{clientId ? '✓ set' : 'MISSING'}</b></p>
  </div>
);
