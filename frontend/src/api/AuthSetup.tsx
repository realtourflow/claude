import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter, api } from './client';
import { useAuthStore } from '../store/authStore';

type SyncUserResponse = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export function AuthSetup({ children }: { children: React.ReactNode }) {
  const { getAccessTokenSilently, user, isAuthenticated } = useAuth0();
  const setFromAuth0 = useAuthStore((state) => state.setFromAuth0);

  useEffect(() => {
    setTokenGetter(getAccessTokenSilently);
  }, [getAccessTokenSilently]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    api.post<SyncUserResponse>('/users/sync', {
      email: user.email ?? '',
      name: user.name ?? '',
    }).then((dbUser) => {
      setFromAuth0(dbUser.id, dbUser.name, dbUser.email, dbUser.role, user.picture);
    }).catch(console.error);
  }, [isAuthenticated, user, setFromAuth0]);

  return <>{children}</>;
}
