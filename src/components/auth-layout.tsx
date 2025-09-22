
"use client";

import { useContext } from 'react';
import { UserContext } from './auth-provider';
import { AuthProvider } from './auth-provider';
import { ProfilesProvider } from './profiles-provider';

// This component wraps the AuthProvider and provides it with a key,
// ensuring it remounts when the user changes.
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user } = useContext(UserContext);

  return (
    <ProfilesProvider>
      <AuthProvider key={user?.id || 'guest'}>
        {children}
      </AuthProvider>
    </ProfilesProvider>
  );
}

    