import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Home() {
  const [status, setStatus] = useState<string>('checking...');

  useEffect(() => {
    api.get<{ status: string }>('/health')
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('unreachable'));
  }, []);

  return (
    <main>
      <h1>RealTour Flow</h1>
      <p>API status: <strong>{status}</strong></p>
    </main>
  );
}
