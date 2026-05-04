import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from './client';

export function AuthSetup({ children }: { children: React.ReactNode }) {
  const { getAccessTokenSilently } = useAuth0();

  useEffect(() => {
    setTokenGetter(getAccessTokenSilently);
  }, [getAccessTokenSilently]);

  return <>{children}</>;
}
