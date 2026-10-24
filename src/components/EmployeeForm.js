'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtMoney } from '@/lib/format';
import { Button, CredentialsNotice, ErrorBox, Field, Input, Modal, Select, Textarea } from './ui';

const EMPTY = {
  code: '', first_name: '', last_name: '', email: '', phone: '', address: '', gender: '', dob: '',
  department_id: '', designation_id: '', employment_type: 'full_time', status: 'active',
  join_date: '', basic_salary: '', hra_pct: 40, medical_pct: 10, other_allowance: 0, exit_date: '',
};

// Register (creates the login too) or edit an employee. HR only.
export function EmployeeForm({ open, employee, onClose, onSaved, currency = 'PKR' }) {
  const depts = useApi(open ? 'org/departments' : null);
  const desigs = useApi(open ? 'org/designations' : null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const editing = !!employee;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError(null);
    setCredentials(null);
    setForm(employee ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, employee[k] ?? EMPTY[k]])) : { ...EMPTY, join_date: new Date().toISOString().slice(0, 10) });
  }, [open, employee]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const gross = Number(form.basic_salary || 0) * (1 + Number(form.hra_pct || 0) / 100 + Number(form.medical_pct || 0) / 100) + Number(form.other_allowance || 0);
  const designationOptions = (desigs.data || []).filter((g) => !g.department_id || String(g.department_id) === String(form.department_id));

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const body = { ...form, department_id: form.department_id ? Number(form.department_id) : undefined, designation_id: form.designation_id ? Number(form.designation_id) : undefined };
      if (!editing) delete body.exit_date;
      if (editing) {
        await api(`employees/${employee.id}`, { method: 'PUT', body });
        onSaved?.();
        onClose();
      } else {
        const r = await api('employees', { method: 'POST', body });
        setCredentials(r.credentials);
        onSaved?.(r.employee);
      }
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      wide
      title={editing ? `Edit ${employee.full_name}` : 'Register employee'}
      onClose={onClose}
      footer={
        credentials ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={submit}>{editing ? 'Save changes' : 'Register and create login'}</Button>
          </>
        )
      }
    >
      {credentials ? (
        <CredentialsNotice credentials={credentials} />
      ) : (
        <form className="stack" onSubmit={submit}>
          <ErrorBox error={error} />
          <h3>Personal</h3>
          <div className="form-grid">
            <Field label="Employee code" error={errors.code}><Input value={form.code} onChange={set('code')} placeholder="EMP-001" /></Field>
            <Field label="Email (login)" error={errors.email}><Input type="email" value={form.email} onChange={set('email')} /></Field>
            <Field label="First name" error={errors.first_name}><Input value={form.first_name} onChange={set('first_name')} /></Field>
            <Field label="Last name" error={errors.last_name}><Input value={form.last_name} onChange={set('last_name')} /></Field>
            <Field label="Phone" error={errors.phone}><Input value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field label="Gender" error={errors.gender}>
              <Select value={form.gender || ''} onChange={set('gender')}>
                <option value="">Not specified</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Date of birth" error={errors.dob}><Input type="date" value={form.dob || ''} onChange={set('dob')} /></Field>
            <Field label="Address" error={errors.address} className="full"><Textarea value={form.address || ''} onChange={set('address')} style={{ minHeight: 60 }} /></Field>
          </div>
          <h3>Job</h3>
          <div className="form-grid">
            <Field label="Department" error={errors.department_id}>
              <Select value={form.department_id || ''} onChange={(e) => setForm({ ...form, department_id: e.target.value, designation_id: '' })} invalid={!!errors.department_id}>
                <option value="">Choose…</option>
                {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Designation" error={errors.designation_id}>
              <Select value={form.designation_id || ''} onChange={set('designation_id')}>
                <option value="">None</option>
                {designationOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </Field>
            <Field label="Employment type">
              <Select value={form.employment_type} onChange={set('employment_type')}>
                <option value="full_time">Full time</option>
                <option value="part_time">Part time</option>
                <option value="contract">Contract</option>
                <option value="intern">Intern</option>
              </Select>
            </Field>
            <Field label="Status" error={errors.status}>
              <Select value={form.status} onChange={set('status')}>
                <option value="active">Active</option>
                <option value="probation">Probation</option>
                {editing && <option value="exited">Exited (leaver)</option>}
              </Select>
            </Field>
            <Field label="Join date" error={errors.join_date}><Input type="date" value={form.join_date || ''} onChange={set('join_date')} /></Field>
            {editing && form.status === 'exited' && (
              <Field label="Exit date (last working day)" error={errors.exit_date} hint="The login is deactivated; payroll is prorated">
                <Input type="date" value={form.exit_date || ''} onChange={set('exit_date')} />
              </Field>
            )}
          </div>
          <h3>Salary structure</h3>
          <div className="form-grid">
            <Field label={`Basic salary (${currency})`} error={errors.basic_salary}><Input type="number" min={1} value={form.basic_salary} onChange={set('basic_salary')} /></Field>
            <Field label={`Other allowance (${currency})`} error={errors.other_allowance}><Input type="number" min={0} value={form.other_allowance} onChange={set('other_allowance')} /></Field>
            <Field label="House rent (% of basic)" error={errors.hra_pct}><Input type="number" min={0} value={form.hra_pct} onChange={set('hra_pct')} /></Field>
            <Field label="Medical (% of basic)" error={errors.medical_pct}><Input type="number" min={0} value={form.medical_pct} onChange={set('medical_pct')} /></Field>
          </div>
          <div className="alert alert-info">Monthly gross: <strong>{fmtMoney(gross, currency)}</strong> (1.5 × basic with the default 40% HRA + 10% medical)</div>
          {!editing && <p className="muted" style={{ fontSize: 12.5 }}>Registering creates the employee&apos;s login with a temporary password that must be changed at first sign-in.</p>}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
