'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate, fmtTime } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { CheckInWidget } from '@/components/CheckInWidget';
import { AttendanceCalendar } from '@/components/AttendanceCalendar';
import { Async, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, StatusBadge, Table, Textarea, useToast } from '@/components/ui';

function MyAttendance() {
  const { user } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(user.settings.today.slice(0, 7));
  const cal = useApi('attendance/calendar', { month });
  const corrections = useApi('attendance/corrections');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: '', check_in: '09:00', check_out: '17:00', reason: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api('attendance/corrections', { method: 'POST', body: form });
      toast('Correction sent to HR');
      setOpen(false);
      corrections.reload();
      cal.reload();
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader
        title="My attendance"
        subtitle="Check in and out, see your month, and request a correction if something is wrong"
        actions={<Button onClick={() => (setOpen(true), setForm({ date: user.settings.today, check_in: '09:00', check_out: '17:00', reason: '' }))}><Plus size={15} /> Request correction</Button>}
      />
      <div className="stack" style={{ gap: 16 }}>
        <CheckInWidget onChange={cal.reload} />
        <Card title="Calendar">
          <Async state={cal}>{cal.data && <AttendanceCalendar data={cal.data} month={month} onMonth={setMonth} today={user.settings.today} />}</Async>
        </Card>
        <Card title="My correction requests" tight>
          <Async state={corrections}>
            <Table
              rows={corrections.data}
              empty="No correction requests"
              columns={[
                { key: 'date', label: 'Date', render: (c) => fmtDate(c.date) },
                { key: 'times', label: 'Requested', render: (c) => `${fmtTime(c.check_in)}–${fmtTime(c.check_out)}` },
                { key: 'reason', label: 'Reason' },
                { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
                { key: 'review_comment', label: 'HR comment' },
              ]}
            />
          </Async>
        </Card>
      </div>
      <Modal open={open} title="Request attendance correction" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Send to HR</Button></>}>
        <form className="stack" onSubmit={submit}>
          <ErrorBox error={error} />
          <Field label="Date" error={errors.date}><Input type="date" max={user.settings.today} value={form.date} onChange={set('date')} /></Field>
          <div className="form-grid">
            <Field label="Actual check-in" error={errors.check_in}><Input type="time" value={form.check_in} onChange={set('check_in')} /></Field>
            <Field label="Actual check-out" error={errors.check_out}><Input type="time" value={form.check_out} onChange={set('check_out')} /></Field>
          </div>
          <Field label="Reason" error={errors.reason}><Textarea value={form.reason} onChange={set('reason')} placeholder="e.g. Forgot to check out, was at a client site" /></Field>
          <small>You cannot edit attendance directly. HR reviews this request.</small>
          <button type="submit" hidden />
        </form>
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['employee', 'hr']}>
      <MyAttendance />
    </RequireRole>
  );
}
