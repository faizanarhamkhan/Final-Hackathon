'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, ErrorBox, Field, Input, Loading } from '@/components/ui';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, ready, acceptSession, logout } = useAuth();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (form.new_password !== form.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try {
      const r = await api('auth/change-password', { method: 'POST', body: { current_password: form.current_password, new_password: form.new_password } });
      acceptSession(r);
      router.replace('/dashboard');
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !user) return <Loading />;
  const forced = user.must_change_password;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthLayout>
      <form className="card card-body stack" onSubmit={submit}>
        <div>
          <h2>{forced ? 'Choose your own password' : 'Change password'}</h2>
          <p className="muted">
            {forced ? `Welcome ${user.name}. You signed in with a temporary password; set a new one to continue.` : 'Enter your current password and a new one.'}
          </p>
        </div>
        <ErrorBox error={error} />
        <Field label={forced ? 'Temporary password' : 'Current password'} error={errors.current_password}>
          <Input type="password" value={form.current_password} onChange={set('current_password')} required autoComplete="current-password" />
        </Field>
        <Field label="New password" error={errors.new_password} hint="8+ characters with letters and numbers">
          <Input type="password" value={form.new_password} onChange={set('new_password')} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <Input type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
        </Field>
        <div className="row">
          <Button variant="primary" loading={busy} type="submit">
            Save password
          </Button>
          {forced ? (
            <Button type="button" variant="ghost" onClick={logout}>
              Sign out
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </AuthLayout>
  );
}
