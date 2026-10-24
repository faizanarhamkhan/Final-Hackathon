'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, ErrorBox, Field, Input, Loading } from '@/components/ui';

const ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'UTC'];

export default function SetupPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState({ company_name: '', timezone: 'Asia/Karachi', admin_name: '', admin_email: '', admin_password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('setup/status')
      .then((s) => (s.setupDone ? router.replace('/login') : setChecking(false)))
      .catch((e) => {
        setError(e);
        setChecking(false);
      });
  }, [router]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (form.admin_password !== form.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try {
      const { confirm, ...body } = form;
      await api('setup', { method: 'POST', body });
      await login(form.admin_email, form.admin_password);
      router.replace('/settings?welcome=1');
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <Loading />;
  return (
    <AuthLayout subtitle="Fresh install: create your company and the Admin account. Everything else is entered in the app, so there is no dummy data.">
      <form className="card card-body stack" onSubmit={submit}>
        <div>
          <h2>First-run setup</h2>
          <p className="muted">Step 1 of the demo: create the company and its Admin.</p>
        </div>
        <ErrorBox error={error} />
        <Field label="Company name" error={errors.company_name}>
          <Input value={form.company_name} onChange={set('company_name')} required autoFocus placeholder="e.g. Saylani Tech" />
        </Field>
        <Field label="Time zone" hint="Used to stamp check-in times and decide lateness">
          <select className="input" value={form.timezone} onChange={set('timezone')}>
            {ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <div className="divider" />
        <Field label="Your name" error={errors.admin_name}>
          <Input value={form.admin_name} onChange={set('admin_name')} required />
        </Field>
        <Field label="Admin email" error={errors.admin_email}>
          <Input type="email" value={form.admin_email} onChange={set('admin_email')} required autoComplete="username" />
        </Field>
        <div className="form-grid">
          <Field label="Password" error={errors.admin_password} hint="8+ characters, letters and numbers">
            <Input type="password" value={form.admin_password} onChange={set('admin_password')} required autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" error={errors.confirm}>
            <Input type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
          </Field>
        </div>
        <Button variant="primary" size="lg" loading={busy} type="submit">
          Create company
        </Button>
      </form>
    </AuthLayout>
  );
}
