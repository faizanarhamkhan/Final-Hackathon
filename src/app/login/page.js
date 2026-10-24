'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, ErrorBox, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { login, user, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState(null);

  useEffect(() => {
    api('setup/status')
      .then((s) => (s.setupDone ? setCompany(s.companyName) : router.replace('/setup')))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    if (ready && user) router.replace(user.must_change_password ? '/change-password' : '/dashboard');
  }, [ready, user, router]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await login(email, password);
      router.replace(u.must_change_password ? '/change-password' : '/dashboard');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="card card-body stack" onSubmit={submit}>
        <div>
          <h2>Sign in{company ? ` to ${company}` : ''}</h2>
          <p className="muted">Admin, HR and Employees use the same sign-in. Your menu depends on your role.</p>
        </div>
        <ErrorBox error={error} />
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Button variant="primary" size="lg" loading={busy} type="submit">
          Sign in
        </Button>
        <p className="muted" style={{ fontSize: 12.5 }}>
          New employee? Use the temporary password from HR. You will be asked to choose a new one.
        </p>
      </form>
    </AuthLayout>
  );
}
