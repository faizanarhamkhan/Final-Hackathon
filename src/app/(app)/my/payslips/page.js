'use client';

import { Download } from 'lucide-react';
import { download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtMoney } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Button, Card, PageHeader, Table, useToast } from '@/components/ui';

function MyPayslips() {
  const { user } = useAuth();
  const toast = useToast();
  const cur = user.settings.currency;
  const state = useApi('payroll/payslips', { employee_id: user.employee_id });
  return (
    <>
      <PageHeader title="My payslips" subtitle="Payslips appear here after Admin finalizes the month's payroll" />
      <Card tight>
        <Async state={state}>
          <Table
            rows={(state.data || []).filter((p) => user.role === 'employee' || p.run_status === 'finalized')}
            empty="No payslips yet"
            columns={[
              { key: 'label', label: 'Month', render: (p) => <strong>{p.label}</strong> },
              { key: 'gross', label: 'Gross', num: true, render: (p) => fmtMoney(p.gross, cur) },
              { key: 'deductions', label: 'Deductions', num: true, render: (p) => fmtMoney(p.deductions, cur) },
              { key: 'tax', label: 'Tax', num: true, render: (p) => fmtMoney(p.tax, cur) },
              { key: 'net', label: 'Net pay', num: true, render: (p) => <strong>{fmtMoney(p.net, cur)}</strong> },
              { key: 'days', label: 'Absent / unpaid / half', render: (p) => `${p.absent_days} / ${p.unpaid_leave_days} / ${p.half_days}` },
              {
                key: '_',
                label: '',
                render: (p) => (
                  <Button size="sm" variant="primary" onClick={() => download(`payroll/payslips/${p.id}/pdf`, 'payslip.pdf').catch((e) => toast(e.message, 'error'))}>
                    <Download size={14} /> PDF
                  </Button>
                ),
              },
            ]}
          />
        </Async>
      </Card>
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['employee', 'hr']}>
      <MyPayslips />
    </RequireRole>
  );
}
