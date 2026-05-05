import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter, api } from './client';

export function AuthSetup({ children }: { children: React.ReactNode }) {
  const { getAccessTokenSilently, user, isAuthenticated } = useAuth0();

  useEffect(() => {
    setTokenGetter(getAccessTokenSilently);
  }, [getAccessTokenSilently]);

  useEffect(() => {
    if (isAuthenticated && user) {
      api.post('/users/sync', {
        email: user.email ?? '',
        name: user.name ?? '',
      }).catch(console.error);
    }
  }, [isAuthenticated, user]);

  return <>{children}</>;
}
