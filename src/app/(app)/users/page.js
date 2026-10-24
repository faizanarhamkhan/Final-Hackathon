'use client';

import { useState } from 'react';
import { KeyRound, Plus, UserCheck, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Badge, Button, Card, CredentialsNotice, ErrorBox, Field, Input, Modal, PageHeader, Select, Table, useToast } from '@/components/ui';

function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState('');
  const state = useApi('users', { role });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', email: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);

  async function createHr(e) {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const r = await api('users/hr', { method: 'POST', body: form });
      setCredentials(r.credentials);
      setForm({ name: '', email: '' });
      state.reload();
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn, ok) {
    try {
      const r = await fn();
      if (r?.credentials) setCredentials(r.credentials);
      toast(ok);
      state.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Users & logins"
        subtitle="Create HR logins, deactivate accounts and reset passwords. Employee logins are created when HR registers an employee."
        actions={
          <Button variant="primary" onClick={() => (setCreating(true), setCredentials(null))}>
            <Plus size={16} /> Create HR login
          </Button>
        }
      />
      {credentials && !creating && (
        <div style={{ marginBottom: 16 }}>
          <CredentialsNotice credentials={credentials} />
        </div>
      )}
      <Card
        tight
        title="All logins"
        actions={
          <Select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 150 }}>
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="hr">HR</option>
            <option value="employee">Employee</option>
          </Select>
        }
      >
        <Async state={state}>
          <Table
            rows={state.data}
            columns={[
              { key: 'name', label: 'Name', render: (u) => <><strong>{u.name}</strong><div className="muted" style={{ fontSize: 12 }}>{u.email}</div></> },
              { key: 'role', label: 'Role', render: (u) => <span className={`role-pill role-${u.role}`}>{u.role}</span> },
              { key: 'employee_code', label: 'Employee', render: (u) => u.employee_code || '—' },
              {
                key: 'is_active',
                label: 'Status',
                render: (u) => (
                  <div className="row" style={{ gap: 4 }}>
                    {u.is_active ? <Badge color="green">Active</Badge> : <Badge color="red">Deactivated</Badge>}
                    {u.must_change_password && <Badge color="orange">Temp password</Badge>}
                  </div>
                ),
              },
              { key: 'last_login_at', label: 'Last sign-in', render: (u) => fmtDateTime(u.last_login_at) },
              {
                key: '_a',
                label: '',
                render: (u) =>
                  u.id === me.id ? (
                    <small>You</small>
                  ) : (
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {u.role !== 'admin' && u.employee_id && (
                        <Button size="sm" onClick={() => act(() => api(`users/${u.id}/role`, { method: 'PATCH', body: { role: u.role === 'hr' ? 'employee' : 'hr' } }), 'Role updated')}>
                          Make {u.role === 'hr' ? 'Employee' : 'HR'}
                        </Button>
                      )}
                      <Button size="sm" title="Reset password" onClick={() => window.confirm(`Reset the password for ${u.name}?`) && act(() => api(`users/${u.id}/reset-password`, { method: 'POST' }), 'Password reset')}>
                        <KeyRound size={14} /> Reset
                      </Button>
                      <Button
                        size="sm"
                        variant={u.is_active ? 'danger' : undefined}
                        onClick={() => act(() => api(`users/${u.id}/status`, { method: 'PATCH', body: { is_active: !u.is_active } }), u.is_active ? 'Login deactivated' : 'Login activated')}
                      >
                        {u.is_active ? <UserX size={14} /> : <UserCheck size={14} />} {u.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  ),
              },
            ]}
          />
        </Async>
      </Card>
      <Modal
        open={creating}
        title="Create HR login"
        onClose={() => setCreating(false)}
        footer={
          credentials ? (
            <Button variant="primary" onClick={() => setCreating(false)}>Done</Button>
          ) : (
            <>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={createHr}>Create login</Button>
            </>
          )
        }
      >
        {credentials ? (
          <CredentialsNotice credentials={credentials} />
        ) : (
          <form className="stack" onSubmit={createHr}>
            <ErrorBox error={error} />
            <Field label="Full name" error={errors.name}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Email" error={errors.email}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <p className="muted" style={{ fontSize: 12.5 }}>A temporary password is generated. The HR user must change it at first sign-in.</p>
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['admin']}>
      <UsersPage />
    </RequireRole>
  );
}
