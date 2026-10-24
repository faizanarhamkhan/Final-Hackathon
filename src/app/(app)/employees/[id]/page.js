'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Pencil, Wallet } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { EmployeeForm } from '@/components/EmployeeForm';
import { AttendanceCalendar } from '@/components/AttendanceCalendar';
import { Async, Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Stat, StatusBadge, Table, useToast } from '@/components/ui';

function SalaryModal({ open, employee, onClose, onSaved, currency }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (open && !form) setForm({ basic_salary: employee.basic_salary, hra_pct: employee.hra_pct, medical_pct: employee.medical_pct, other_allowance: employee.other_allowance });
  if (!open && form) setForm(null);
  if (!form) return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const gross = Number(form.basic_salary || 0) * (1 + Number(form.hra_pct) / 100 + Number(form.medical_pct) / 100) + Number(form.other_allowance || 0);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`employees/${employee.id}/salary`, { method: 'PUT', body: form });
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} title="Salary structure" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label={`Basic (${currency})`}><Input type="number" value={form.basic_salary} onChange={set('basic_salary')} /></Field>
          <Field label={`Other allowance (${currency})`}><Input type="number" value={form.other_allowance} onChange={set('other_allowance')} /></Field>
          <Field label="HRA % of basic"><Input type="number" value={form.hra_pct} onChange={set('hra_pct')} /></Field>
          <Field label="Medical % of basic"><Input type="number" value={form.medical_pct} onChange={set('medical_pct')} /></Field>
        </div>
        <div className="alert alert-info">Monthly gross: <strong>{fmtMoney(gross, currency)}</strong>. Applies to payroll runs created or recalculated from now on.</div>
      </div>
    </Modal>
  );
}

export default function Employee360({ params }) {
  const { id } = use(params);
  const { user } = useAuth();
  const toast = useToast();
  const cur = user.settings.currency;
  const isHr = user.role === 'hr';
  const emp = useApi(`employees/${id}`);
  const [month, setMonth] = useState(user.settings.today.slice(0, 7));
  const cal = useApi('attendance/calendar', { employee_id: id, month });
  const bal = useApi('leave/balance', { employee_id: id });
  const leaves = useApi('leave/requests', { employee_id: id });
  const slips = useApi('payroll/payslips', { employee_id: id });
  const [editing, setEditing] = useState(false);
  const [salary, setSalary] = useState(false);

  if (emp.loading && !emp.data) return <Loading />;
  if (emp.error) return <ErrorBox error={emp.error} onRetry={emp.reload} />;
  const e = emp.data;
  return (
    <>
      <Link href={user.role === 'employee' ? '/dashboard' : '/employees'} className="row muted" style={{ marginBottom: 10 }}>
        <ArrowLeft size={15} /> Back
      </Link>
      <PageHeader
        title={e.full_name}
        subtitle={`${e.code} · ${e.designation || 'No designation'} · ${e.department || 'No department'}`}
        actions={
          isHr && (
            <>
              <Button onClick={() => setSalary(true)}><Wallet size={15} /> Salary</Button>
              <Button variant="primary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>
            </>
          )
        }
      />
      <div className="stack" style={{ gap: 16 }}>
        <div className="grid grid-4">
          <Stat label="Status" value={<StatusBadge status={e.status} />} sub={e.exit_date ? `Exited ${fmtDate(e.exit_date)}` : `Joined ${fmtDate(e.join_date)}`} />
          <Stat label="Monthly gross" value={fmtMoney(e.salary.gross, cur)} tone="primary" sub={`Basic ${fmtMoney(e.salary.basic, cur)}`} />
          <Stat label="Attendance (month)" value={cal.data?.summary.attendance_rate == null ? '—' : `${cal.data.summary.attendance_rate}%`} tone="accent" />
          <Stat label="Login" value={e.login_active ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>} sub={e.last_login_at ? `Last sign-in ${fmtDateTime(e.last_login_at)}` : 'Never signed in'} />
        </div>
        <div className="grid grid-2">
          <Card title="Profile">
            <dl className="kv">
              <dt>Email</dt><dd>{e.email}</dd>
              <dt>Phone</dt><dd>{e.phone || '—'}</dd>
              <dt>Address</dt><dd>{e.address || '—'}</dd>
              <dt>Gender</dt><dd>{titleCase(e.gender) || '—'}</dd>
              <dt>Date of birth</dt><dd>{fmtDate(e.dob)}</dd>
              <dt>Employment</dt><dd>{titleCase(e.employment_type)}</dd>
              <dt>Joined</dt><dd>{fmtDate(e.join_date)}</dd>
            </dl>
          </Card>
          <Card title="Salary structure">
            <dl className="kv">
              <dt>Basic</dt><dd>{fmtMoney(e.salary.basic, cur)}</dd>
              <dt>House rent ({e.salary.hra_pct}%)</dt><dd>{fmtMoney(e.salary.hra, cur)}</dd>
              <dt>Medical ({e.salary.medical_pct}%)</dt><dd>{fmtMoney(e.salary.medical, cur)}</dd>
              <dt>Other allowance</dt><dd>{fmtMoney(e.salary.other_allowance, cur)}</dd>
              <dt>Monthly gross</dt><dd><strong>{fmtMoney(e.salary.gross, cur)}</strong></dd>
            </dl>
          </Card>
        </div>
        <Card title="Attendance">
          <Async state={cal}>{cal.data && <AttendanceCalendar data={cal.data} month={month} onMonth={setMonth} today={user.settings.today} />}</Async>
        </Card>
        <div className="grid grid-2">
          <Card title="Leave balance" tight>
            <Async state={bal}>
              <Table
                rows={bal.data}
                rowKey={(b) => b.leave_type_id}
                columns={[
                  { key: 'name', label: 'Type' },
                  { key: 'quota', label: 'Quota', num: true, render: (b) => b.quota ?? '∞' },
                  { key: 'used', label: 'Used', num: true },
                  { key: 'pending', label: 'Pending', num: true },
                  { key: 'remaining', label: 'Left', num: true, render: (b) => b.remaining ?? '∞' },
                ]}
              />
            </Async>
          </Card>
          <Card title="Payslips" tight>
            <Async state={slips}>
              <Table
                rows={slips.data}
                empty="No payslips yet"
                columns={[
                  { key: 'label', label: 'Month' },
                  { key: 'run_status', label: 'Run', render: (p) => <StatusBadge status={p.run_status} /> },
                  { key: 'net', label: 'Net', num: true, render: (p) => fmtMoney(p.net, cur) },
                  { key: '_', label: '', render: (p) => <Button size="sm" onClick={() => download(`payroll/payslips/${p.id}/pdf`, 'payslip.pdf').catch((x) => toast(x.message, 'error'))}><Download size={14} /> PDF</Button> },
                ]}
              />
            </Async>
          </Card>
        </div>
        <Card title="Leave history" tight>
          <Async state={leaves}>
            <Table
              rows={leaves.data}
              empty="No leave requests"
              columns={[
                { key: 'type_name', label: 'Type' },
                { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
                { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
                { key: 'days', label: 'Days', num: true },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'review_comment', label: 'HR comment' },
              ]}
            />
          </Async>
        </Card>
      </div>
      {isHr && <EmployeeForm open={editing} employee={e} currency={cur} onClose={() => setEditing(false)} onSaved={() => (emp.reload(), toast('Employee updated'))} />}
      {isHr && <SalaryModal open={salary} employee={e} currency={cur} onClose={() => setSalary(false)} onSaved={() => (emp.reload(), toast('Salary updated'))} />}
    </>
  );
}
