'use client';

import { useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { RequireRole } from '@/components/AppShell';
import { LeaveForm } from '@/components/LeaveForm';
import { Async, Badge, Button, Card, ErrorBox, Input, PageHeader, Stat, StatusBadge, Table, useToast } from '@/components/ui';

function MyLeave() {
  const toast = useToast();
  const balances = useApi('leave/balance');
  const requests = useApi('leave/requests');
  const [form, setForm] = useState(null); // { draft?, warnings? }
  const [text, setText] = useState('');
  const [smart, setSmart] = useState({ busy: false, error: null, message: null });

  useEffect(() => {
    const reload = () => (balances.reload(), requests.reload());
    window.addEventListener('hcm:leave-changed', reload);
    return () => window.removeEventListener('hcm:leave-changed', reload);
  });

  async function runSmart(e) {
    e.preventDefault();
    setSmart({ busy: true, error: null, message: null });
    try {
      const r = await api('ai/smart-leave', { method: 'POST', body: { text } });
      if (r.ok) {
        setForm({ draft: r.draft, warnings: r.warnings });
        setSmart({ busy: false, error: null, message: null });
      } else {
        // Could not understand: fall back to the normal form.
        setSmart({ busy: false, error: null, message: r.message || r.error });
        setForm({});
      }
    } catch (err) {
      setSmart({ busy: false, error: err, message: null });
    }
  }

  async function cancel(r) {
    if (!window.confirm(`Cancel your ${r.type_name} from ${fmtDate(r.start_date)}?`)) return;
    try {
      await api(`leave/requests/${r.id}/cancel`, { method: 'POST' });
      toast('Leave cancelled');
      balances.reload();
      requests.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <>
      <PageHeader title="My leave" subtitle="Balance, history and requests" actions={<Button variant="primary" onClick={() => setForm({})}><Plus size={15} /> Apply for leave</Button>} />
      <div className="stack" style={{ gap: 16 }}>
        <Async state={balances}>
          <div className="grid grid-4">
            {(balances.data || []).map((b) => (
              <Stat key={b.code} label={b.name} value={b.remaining ?? '∞'} sub={b.quota == null ? 'unlimited, unpaid' : `left of ${b.quota} · ${b.used} used${b.pending ? ` · ${b.pending} pending` : ''}`} />
            ))}
          </div>
        </Async>
        <Card title={<div className="row"><Sparkles size={16} color="var(--accent)" /><h3>Smart leave</h3></div>}>
          <form className="stack" onSubmit={runSmart}>
            <p className="muted">Describe your leave in plain words (English or Roman Urdu). The assistant fills in the form; you confirm before anything is sent.</p>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Need next Monday and Tuesday off for my sister's wedding" maxLength={500} />
              <Button variant="accent" loading={smart.busy} disabled={text.trim().length < 3} type="submit">Fill form</Button>
            </div>
            {smart.message && <div className="alert alert-warn">{smart.message}</div>}
            <ErrorBox error={smart.error} />
          </form>
        </Card>
        <Card title="My requests" tight>
          <Async state={requests}>
            <Table
              rows={requests.data}
              empty="No leave requests yet"
              columns={[
                { key: 'type_name', label: 'Type' },
                { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
                { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
                { key: 'days', label: 'Days', num: true },
                { key: 'reason', label: 'Reason', render: (r) => <>{r.reason} {r.source === 'ai' && <Badge color="purple">smart</Badge>}</> },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'review_comment', label: 'HR comment' },
                {
                  key: '_',
                  label: '',
                  render: (r) =>
                    (r.status === 'pending' || (r.status === 'approved' && r.start_date > new Date().toISOString().slice(0, 10))) && (
                      <Button size="sm" onClick={() => cancel(r)}>Cancel</Button>
                    ),
                },
              ]}
            />
          </Async>
        </Card>
      </div>
      <LeaveForm
        open={!!form}
        draft={form?.draft}
        warnings={form?.warnings || []}
        onClose={() => setForm(null)}
        onSaved={() => {
          setText('');
          balances.reload();
          requests.reload();
        }}
      />
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['employee', 'hr']}>
      <MyLeave />
    </RequireRole>
  );
}
