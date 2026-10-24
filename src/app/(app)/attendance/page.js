'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate, fmtPct, fmtTime } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Table, Tabs, Textarea, useToast } from '@/components/ui';

function Board() {
  const { user } = useAuth();
  const [date, setDate] = useState(user.settings.today);
  const [dept, setDept] = useState('');
  const depts = useApi('org/departments');
  const state = useApi('attendance/board', { date, department_id: dept });
  const d = state.data;
  const c = d?.summary.counts;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card card-body filters">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Department">
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All</option>
            {(depts.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
      </div>
      <Async state={state}>
        {d && (
          <>
            <div className="grid grid-5">
              <Stat label="Present" value={c.present + c.late + c.half_day + c.missing_checkout} tone="primary" />
              <Stat label="Late" value={d.summary.late_arrivals} tone="warn" />
              <Stat label="On leave" value={c.on_leave} tone="accent" />
              <Stat label="Absent" value={c.absent} tone="danger" />
              <Stat label="Attendance rate" value={fmtPct(d.summary.attendance_rate)} />
            </div>
            <Card title={`Daily board · ${fmtDate(d.date)}`} tight>
              <Table
                rows={d.rows}
                rowKey={(r) => r.employee_id}
                empty="No employees were employed on this date"
                columns={[
                  { key: 'code', label: 'Code' },
                  { key: 'name', label: 'Employee' },
                  { key: 'department', label: 'Department' },
                  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status}>{r.status === 'on_leave' ? r.leave_name : undefined}</StatusBadge> },
                  { key: 'check_in', label: 'In', render: (r) => fmtTime(r.check_in) },
                  { key: 'check_out', label: 'Out', render: (r) => fmtTime(r.check_out) },
                  { key: 'hours', label: 'Hours', num: true, render: (r) => r.hours ?? '—' },
                  { key: 'source', label: 'Source', render: (r) => (r.source ? <Badge color={r.source === 'camera' ? 'blue' : r.source === 'correction' ? 'purple' : ''}>{r.source}</Badge> : '—') },
                ]}
              />
            </Card>
          </>
        )}
      </Async>
    </div>
  );
}

function Corrections() {
  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const state = useApi('attendance/corrections', { status });
  const [reviewing, setReviewing] = useState(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const canReview = user.role === 'hr';

  async function decide(decision) {
    setBusy(true);
    setError(null);
    try {
      await api(`attendance/corrections/${reviewing.c.id}/review`, { method: 'POST', body: { decision, comment } });
      toast(`Correction ${decision}`);
      setReviewing(null);
      state.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      tight
      title="Correction requests"
      actions={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 140 }}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </Select>
      }
    >
      <Async state={state}>
        <Table
          rows={state.data}
          empty="No correction requests"
          columns={[
            { key: 'name', label: 'Employee', render: (c) => <><strong>{c.name}</strong><div className="muted" style={{ fontSize: 12 }}>{c.department}</div></> },
            { key: 'date', label: 'Date', render: (c) => fmtDate(c.date) },
            { key: 'current', label: 'Recorded', render: (c) => (c.current_check_in ? `${fmtTime(c.current_check_in)}–${fmtTime(c.current_check_out)}` : 'No record') },
            { key: 'requested', label: 'Requested', render: (c) => `${fmtTime(c.check_in)}–${fmtTime(c.check_out)}` },
            { key: 'reason', label: 'Reason' },
            { key: 'status', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            {
              key: '_',
              label: '',
              render: (c) =>
                c.status === 'pending' && canReview ? (
                  <Button size="sm" variant="primary" onClick={() => (setReviewing({ c }), setComment(''), setError(null))}>
                    Review
                  </Button>
                ) : (
                  <small>{c.reviewer_name ? `${c.reviewer_name}${c.review_comment ? `: ${c.review_comment}` : ''}` : ''}</small>
                ),
            },
          ]}
        />
      </Async>
      <Modal
        open={!!reviewing}
        title="Review correction"
        onClose={() => setReviewing(null)}
        footer={
          <>
            <Button variant="danger" loading={busy} onClick={() => decide('rejected')}><X size={15} /> Reject</Button>
            <Button variant="primary" loading={busy} onClick={() => decide('approved')}><Check size={15} /> Approve</Button>
          </>
        }
      >
        {reviewing && (
          <div className="stack">
            <dl className="kv">
              <dt>Employee</dt><dd>{reviewing.c.name}</dd>
              <dt>Date</dt><dd>{fmtDate(reviewing.c.date)}</dd>
              <dt>Requested times</dt><dd>{fmtTime(reviewing.c.check_in)} – {fmtTime(reviewing.c.check_out)}</dd>
              <dt>Reason</dt><dd>{reviewing.c.reason}</dd>
            </dl>
            <Field label="Comment" hint="Required when rejecting">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <ErrorBox error={error} />
            <small>Approving writes the attendance record (source: correction) and re-applies the current late/half-day rules.</small>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function AttendancePage() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'corrections' ? 'corrections' : 'board');
  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily board and correction requests" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'board', label: 'Daily board' }, { value: 'corrections', label: 'Corrections' }]} />
      {tab === 'board' ? <Board /> : <Corrections />}
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['admin', 'hr']}>
      <Suspense>
        <AttendancePage />
      </Suspense>
    </RequireRole>
  );
}
