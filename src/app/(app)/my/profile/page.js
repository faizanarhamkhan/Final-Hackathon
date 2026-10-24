'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate, fmtMoney, titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Button, Card, ErrorBox, Field, Input, PageHeader, StatusBadge, Textarea, useToast } from '@/components/ui';

function MyProfile() {
  const { user } = useAuth();
  const toast = useToast();
  const state = useApi('me/profile');
  const [form, setForm] = useState({ phone: '', address: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const e = state.data;

  useEffect(() => {
    if (e) setForm({ phone: e.phone || '', address: e.address || '' });
  }, [e]);

  async function save(ev) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('me/profile', { method: 'PATCH', body: form });
      toast('Contact details saved');
      state.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="My profile" subtitle="You can update your phone and address. Ask HR to change anything else." />
      <Async state={state}>
        {e && (
          <div className="grid grid-2">
            <Card title="Job details">
              <dl className="kv">
                <dt>Name</dt><dd>{e.full_name}</dd>
                <dt>Employee code</dt><dd>{e.code}</dd>
                <dt>Email</dt><dd>{e.email}</dd>
                <dt>Department</dt><dd>{e.department || '—'}</dd>
                <dt>Designation</dt><dd>{e.designation || '—'}</dd>
                <dt>Employment</dt><dd>{titleCase(e.employment_type)}</dd>
                <dt>Status</dt><dd><StatusBadge status={e.status} /></dd>
                <dt>Joined</dt><dd>{fmtDate(e.join_date)}</dd>
                <dt>Monthly gross</dt><dd>{fmtMoney(e.salary.gross, user.settings.currency)}</dd>
              </dl>
            </Card>
            <Card title="Contact details">
              <form className="stack" onSubmit={save}>
                <ErrorBox error={error} />
                <Field label="Phone"><Input value={form.phone} onChange={(x) => setForm({ ...form, phone: x.target.value })} /></Field>
                <Field label="Address"><Textarea value={form.address} onChange={(x) => setForm({ ...form, address: x.target.value })} /></Field>
                <div><Button variant="primary" loading={busy} type="submit">Save</Button></div>
              </form>
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['employee', 'hr']}>
      <MyProfile />
    </RequireRole>
  );
}
