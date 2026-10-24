'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, StatusBadge, Table, Textarea, useToast } from '@/components/ui';

function LeaveAdmin() {
  const { user } = useAuth();
  const toast = useToast();
  const canReview = user.role === 'hr';
  const [filters, setFilters] = useState({ status: 'pending', department_id: '', leave_type_id: '', from: '', to: '' });
  const state = useApi('leave/requests', filters);
  const depts = useApi('org/departments');
  const types = useApi('org/leave-types');
  const [reviewing, setReviewing] = useState(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  async function decide(decision) {
    setBusy(true);
    setError(null);
    try {
      await api(`leave/requests/${reviewing.id}/review`, { method: 'POST', body: { decision, comment } });
      toast(`Leave ${decision}. The employee has been notified.`);
      setReviewing(null);
      state.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={canReview ? 'Leave approvals' : 'Leave'} subtitle={canReview ? 'Approve or reject requests with a comment. Balances and overlaps are re-checked on approval.' : 'All leave requests (view only)'} />
      <div className="card card-body filters" style={{ marginBottom: 16 }}>
        <Field label="Status">
          <Select value={filters.status} onChange={set('status')}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All</option>
          </Select>
        </Field>
        <Field label="Department">
          <Select value={filters.department_id} onChange={set('department_id')}>
            <option value="">All</option>
            {(depts.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={filters.leave_type_id} onChange={set('leave_type_id')}>
            <option value="">All</option>
            {(types.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={filters.from} onChange={set('from')} /></Field>
        <Field label="To"><Input type="date" value={filters.to} onChange={set('to')} /></Field>
      </div>
      <Card tight title={state.data ? `${state.data.length} request(s)` : 'Requests'}>
        <Async state={state}>
          <Table
            rows={state.data}
            empty={filters.status === 'pending' ? 'No pending requests. All caught up!' : 'No requests match'}
            columns={[
              { key: 'name', label: 'Employee', render: (r) => <><strong>{r.name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.department}</div></> },
              { key: 'type_name', label: 'Type' },
              { key: 'dates', label: 'Dates', render: (r) => `${fmtDate(r.start_date)}${r.end_date !== r.start_date ? ` – ${fmtDate(r.end_date)}` : ''}` },
              { key: 'days', label: 'Days', num: true },
              { key: 'reason', label: 'Reason', render: (r) => <>{r.reason} {r.source === 'ai' && <Badge color="purple">smart leave</Badge>}</> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              {
                key: '_',
                label: '',
                render: (r) =>
                  r.status === 'pending' && canReview ? (
                    <Button size="sm" variant="primary" disabled={r.employee_id === user.employee_id} title={r.employee_id === user.employee_id ? 'You cannot approve your own leave' : undefined} onClick={() => (setReviewing(r), setComment(''), setError(null))}>
                      Review
                    </Button>
                  ) : (
                    <small>{r.reviewer_name ? `${r.reviewer_name}${r.review_comment ? `: "${r.review_comment}"` : ''}` : fmtDateTime(r.created_at)}</small>
                  ),
              },
            ]}
          />
        </Async>
      </Card>
      <Modal
        open={!!reviewing}
        title="Review leave request"
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
              <dt>Employee</dt><dd>{reviewing.name} ({reviewing.employee_code})</dd>
              <dt>Type</dt><dd>{reviewing.type_name}</dd>
              <dt>Dates</dt><dd>{fmtDate(reviewing.start_date)} – {fmtDate(reviewing.end_date)} ({reviewing.days} working day{reviewing.days === 1 ? '' : 's'})</dd>
              <dt>Reason</dt><dd>{reviewing.reason}</dd>
            </dl>
            <Field label="Comment to employee" hint="Required when rejecting">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <ErrorBox error={error} />
          </div>
        )}
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['admin', 'hr']}>
      <LeaveAdmin />
    </RequireRole>
  );
}
