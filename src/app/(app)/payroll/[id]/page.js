'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Button, Card, ErrorBox, Modal, PageHeader, Stat, StatusBadge, Table, useToast } from '@/components/ui';

function RunDetail({ id }) {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const cur = user.settings.currency;
  const state = useApi(`payroll/runs/${id}`);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const r = state.data;

  async function act(fn, msg) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(msg);
      state.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/payroll" className="row muted" style={{ marginBottom: 10 }}>
        <ArrowLeft size={15} /> All runs
      </Link>
      <Async state={state}>
        {r && (
          <>
            <PageHeader
              title={`Payroll · ${r.label}`}
              subtitle={r.status === 'finalized' ? `Finalized by ${r.finalized_by_name} on ${fmtDateTime(r.finalized_at)} · locked` : `Draft prepared by ${r.created_by_name || 'HR'}`}
              actions={
                <>
                  <StatusBadge status={r.status} />
                  {r.status === 'draft' && user.role === 'hr' && (
                    <>
                      <Button loading={busy} onClick={() => act(() => api('payroll/runs', { method: 'POST', body: { month: r.month } }), 'Draft recalculated')}>
                        <RefreshCw size={15} /> Recalculate
                      </Button>
                      <Button
                        variant="ghost"
                        className="icon-btn"
                        aria-label="Delete draft"
                        title="Delete draft"
                        onClick={() =>
                          window.confirm('Delete this draft?') &&
                          api(`payroll/runs/${r.id}`, { method: 'DELETE' })
                            .then(() => router.push('/payroll'))
                            .catch(setError)
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </>
                  )}
                  {r.status === 'draft' && user.role === 'admin' && (
                    <Button variant="primary" onClick={() => setConfirming(true)}>
                      <Lock size={15} /> Finalize payroll
                    </Button>
                  )}
                </>
              }
            />
            <ErrorBox error={error} />
            <div className="grid grid-4" style={{ margin: '16px 0' }}>
              <Stat label="Employees" value={r.employee_count} sub={`${r.working_days} working days`} />
              <Stat label="Total gross" value={fmtMoney(r.total_gross, cur)} />
              <Stat label="Deductions + tax" value={fmtMoney(r.total_deductions + r.total_tax, cur)} tone="danger" sub={`tax ${fmtMoney(r.total_tax, cur)}`} />
              <Stat label="Total net" value={fmtMoney(r.total_net, cur)} tone="primary" />
            </div>
            <Card title="Payslips" tight>
              <Table
                rows={r.payslips}
                columns={[
                  { key: 'code', label: 'Code' },
                  { key: 'name', label: 'Employee', render: (p) => <><strong>{p.name}</strong><div className="muted" style={{ fontSize: 12 }}>{p.department}</div></> },
                  { key: 'monthly_gross', label: 'Monthly gross', num: true, render: (p) => fmtMoney(p.monthly_gross, cur) },
                  { key: 'employed_days', label: 'Days', num: true, render: (p) => `${p.employed_days}/${p.working_days}` },
                  { key: 'absent_days', label: 'Absent', num: true },
                  { key: 'unpaid_leave_days', label: 'Unpaid', num: true },
                  { key: 'half_days', label: 'Half', num: true },
                  { key: 'gross', label: 'Gross', num: true, render: (p) => fmtMoney(p.gross, cur) },
                  { key: 'deductions', label: 'Deductions', num: true, render: (p) => fmtMoney(p.deductions, cur) },
                  { key: 'tax', label: 'Tax', num: true, render: (p) => fmtMoney(p.tax, cur) },
                  { key: 'net', label: 'Net', num: true, render: (p) => <strong>{fmtMoney(p.net, cur)}</strong> },
                  { key: '_', label: '', render: (p) => <Button size="sm" className="icon-btn" aria-label="Download payslip PDF" title="Download PDF" onClick={() => download(`payroll/payslips/${p.id}/pdf`, 'payslip.pdf').catch((e) => toast(e.message, 'error'))}><Download size={14} /></Button> },
                ]}
              />
            </Card>
            <Modal
              open={confirming}
              title={`Finalize ${r.label} payroll?`}
              onClose={() => setConfirming(false)}
              footer={
                <>
                  <Button onClick={() => setConfirming(false)}>Cancel</Button>
                  <Button variant="primary" loading={busy} onClick={() => act(() => api(`payroll/runs/${r.id}/finalize`, { method: 'POST' }), 'Payroll finalized and locked').then(() => setConfirming(false))}>
                    <Lock size={15} /> Finalize and lock
                  </Button>
                </>
              }
            >
              <p>
                This locks {r.employee_count} payslips totalling <strong>{fmtMoney(r.total_net, cur)}</strong> net. Nobody can edit or recalculate this month afterwards, and employees are
                notified that their payslips are ready.
              </p>
            </Modal>
          </>
        )}
      </Async>
    </>
  );
}

export default function Page({ params }) {
  const { id } = use(params);
  return (
    <RequireRole roles={['admin', 'hr']}>
      <RunDetail id={id} />
    </RequireRole>
  );
}
