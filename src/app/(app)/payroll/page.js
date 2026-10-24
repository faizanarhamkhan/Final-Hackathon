'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Button, Card, ErrorBox, Field, Input, PageHeader, StatusBadge, Table, useToast } from '@/components/ui';

function PayrollPage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const isHr = user.role === 'hr';
  const cur = user.settings.currency;
  const runs = useApi('payroll/runs');
  const [month, setMonth] = useState(user.settings.today.slice(0, 7));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('payroll/runs', { method: 'POST', body: { month } });
      toast(`Draft for ${r.label} calculated for ${r.employee_count} employees`);
      router.push(`/payroll/${r.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Payroll" subtitle={isHr ? 'Create and review the monthly draft. Admin finalizes and locks it.' : 'Review drafts prepared by HR and finalize them. Finalized months are locked.'} />
      {isHr && (
        <Card title="Run payroll" style={{ marginBottom: 16 }}>
          <div className="filters">
            <Field label="Month">
              <Input type="month" value={month} max={user.settings.today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Button variant="primary" loading={busy} onClick={create}>
              <Calculator size={16} /> Create / recalculate draft
            </Button>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
            Gross = basic + 40% HRA + 10% medical. Per day = gross ÷ working days; absent, unpaid leave and half days (×0.5) are deducted. Joiners and leavers are prorated;
            tax uses the annual slab on gross × 12.
          </p>
          <ErrorBox error={error} />
        </Card>
      )}
      <Card title="Payroll runs" tight>
        <Async state={runs}>
          <Table
            rows={runs.data}
            onRowClick={(r) => router.push(`/payroll/${r.id}`)}
            empty={isHr ? 'No payroll runs yet. Pick a month above.' : 'HR has not prepared any payroll yet'}
            columns={[
              { key: 'label', label: 'Month', render: (r) => <strong>{r.label}</strong> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'employee_count', label: 'Employees', num: true },
              { key: 'total_gross', label: 'Gross', num: true, render: (r) => fmtMoney(r.total_gross, cur) },
              { key: 'total_tax', label: 'Tax', num: true, render: (r) => fmtMoney(r.total_tax, cur) },
              { key: 'total_net', label: 'Net', num: true, render: (r) => fmtMoney(r.total_net, cur) },
              { key: 'by', label: 'Finalized', render: (r) => (r.finalized_at ? `${r.finalized_by_name} · ${fmtDateTime(r.finalized_at)}` : '—') },
            ]}
          />
        </Async>
      </Card>
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['admin', 'hr']}>
      <PayrollPage />
    </RequireRole>
  );
}
