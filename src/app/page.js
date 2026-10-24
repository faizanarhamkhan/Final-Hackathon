'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { Loading } from '@/components/ui';

// Entry point: fresh install -> setup, otherwise login or dashboard.
export default function Home() {
  const router = useRouter();
  const { user, ready } = useAuth();
  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const s = await api('setup/status');
        if (!s.setupDone) return router.replace('/setup');
      } catch {
        // fall through to login, which shows the error
      }
      if (!user) router.replace('/login');
      else if (user.must_change_password) router.replace('/change-password');
      else router.replace('/dashboard');
    })();
  }, [ready, user, router]);
  return <Loading label="Starting HCM Lite…" />;
}
