'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileUp, Plus, Search } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { EmployeeForm } from '@/components/EmployeeForm';
import { Async, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, StatusBadge, Table, useToast } from '@/components/ui';

function ImportModal({ open, onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun) {
    setBusy(true);
    setError(null);
    try {
      const r = await api('employees/import', { method: 'POST', body: { csv, dryRun } });
      setResult(r);
      if (!dryRun && r.imported) onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setCsv('');
    setFileName('');
    setResult(null);
    setError(null);
    onClose();
  }
  const canImport = result?.dryRun && result.errors.length === 0 && result.valid > 0;
  return (
    <Modal
      open={open}
      wide
      title="Import employees from CSV"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{result && !result.dryRun ? 'Done' : 'Cancel'}</Button>
          {!(result && !result.dryRun) && (
            <>
              <Button loading={busy} disabled={!csv} onClick={() => run(true)}>Dry run</Button>
              <Button variant="primary" loading={busy} disabled={!canImport} onClick={() => run(false)}>Import {result?.valid || ''} employees</Button>
            </>
          )}
        </>
      }
    >
      <div className="stack">
        <p className="muted">
          Columns: <code>code, first_name, last_name, email, phone, gender, department, designation, join_date, basic_salary, status</code>. Departments must already exist;
          dates use YYYY-MM-DD. Run a dry run first; the import only runs when every row is valid.{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), download('employees/template.csv', 'employees-template.csv'))}>Download template</a>
        </p>
        <Field label="CSV file">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setCsv(await f.text());
              setResult(null);
            }}
          />
        </Field>
        {fileName && <small>{fileName} · {csv.split(/\r?\n/).filter(Boolean).length - 1} data rows</small>}
        <ErrorBox error={error} />
        {result && (
          <>
            <div className={`alert ${result.errors.length ? 'alert-warn' : 'alert-success'}`}>
              {result.dryRun
                ? `${result.total} rows checked: ${result.valid} valid, ${result.invalid} with errors.`
                : `Imported ${result.imported} employees. Their logins were created with temporary passwords below.`}
            </div>
            {result.errors.length > 0 && (
              <Card title="Errors" tight>
                <Table columns={[{ key: 'row', label: 'Row', num: true }, { key: 'field', label: 'Field' }, { key: 'reason', label: 'Reason' }]} rows={result.errors} rowKey={(r, i) => i} />
              </Card>
            )}
            {result.credentials && (
              <Card
                title="New logins"
                tight
                actions={
                  <Button
                    size="sm"
                    onClick={() => {
                      const text = ['code,name,email,temporary_password', ...result.credentials.map((c) => `${c.code},${c.name},${c.email},${c.tempPassword}`)].join('\n');
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
                      a.download = 'new-logins.csv';
                      a.click();
                    }}
                  >
                    <Download size={14} /> Save as CSV
                  </Button>
                }
              >
                <Table columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'tempPassword', label: 'Temp password', render: (c) => <code>{c.tempPassword}</code> }]} rows={result.credentials} rowKey={(c) => c.code} />
              </Card>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function EmployeesPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const isHr = user.role === 'hr';
  const [filters, setFilters] = useState({ search: '', department_id: '', status: 'current', page: 1 });
  const [search, setSearch] = useState('');
  const state = useApi('employees', { ...filters, pageSize: 15 });
  const depts = useApi('org/departments');
  const [registering, setRegistering] = useState(false);
  const [importing, setImporting] = useState(false);
  const d = state.data;
  const cur = user.settings.currency;

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={isHr ? 'Register employees (this creates their login), search, import and export' : 'Company directory (view only)'}
        actions={
          isHr && (
            <>
              <Button onClick={() => download(`employees/export.csv?${new URLSearchParams({ status: filters.status, department_id: filters.department_id })}`, 'employees.csv').catch((e) => toast(e.message, 'error'))}>
                <Download size={16} /> Export CSV
              </Button>
              <Button onClick={() => setImporting(true)}>
                <FileUp size={16} /> Import CSV
              </Button>
              <Button variant="primary" onClick={() => setRegistering(true)}>
                <Plus size={16} /> Register employee
              </Button>
            </>
          )
        }
      />
      <form
        className="card card-body filters"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, search, page: 1 });
        }}
      >
        <Field label="Search" className="grow">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code, email or phone" />
        </Field>
        <Field label="Department">
          <Select value={filters.department_id} onChange={(e) => setFilters({ ...filters, department_id: e.target.value, page: 1 })}>
            <option value="">All</option>
            {(depts.data || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}>
            <option value="current">Current (active + probation)</option>
            <option value="active">Active</option>
            <option value="probation">Probation</option>
            <option value="exited">Exited</option>
            <option value="">All</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary"><Search size={15} /> Search</Button>
      </form>
      <Card tight title={d ? `${d.total} employee${d.total === 1 ? '' : 's'}` : 'Employees'}>
        <Async state={state}>
          {d && (
            <>
              <Table
                rows={d.rows}
                onRowClick={(e) => router.push(`/employees/${e.id}`)}
                empty={isHr ? 'No employees yet. Click "Register employee" to add the first one.' : 'No employees yet'}
                columns={[
                  { key: 'code', label: 'Code' },
                  { key: 'full_name', label: 'Name', render: (e) => <><strong>{e.full_name}</strong><div className="muted" style={{ fontSize: 12 }}>{e.email}</div></> },
                  { key: 'department', label: 'Department' },
                  { key: 'designation', label: 'Designation' },
                  { key: 'join_date', label: 'Joined', render: (e) => fmtDate(e.join_date) },
                  { key: 'gross', label: 'Monthly gross', num: true, render: (e) => fmtMoney(e.salary.gross, cur) },
                  { key: 'status', label: 'Status', render: (e) => <StatusBadge status={e.status} /> },
                ]}
              />
              {d.pages > 1 && (
                <div className="row" style={{ justifyContent: 'flex-end', padding: 12 }}>
                  <Button size="sm" disabled={d.page <= 1} onClick={() => setFilters({ ...filters, page: d.page - 1 })}>Previous</Button>
                  <span className="muted">Page {d.page} of {d.pages}</span>
                  <Button size="sm" disabled={d.page >= d.pages} onClick={() => setFilters({ ...filters, page: d.page + 1 })}>Next</Button>
                </div>
              )}
            </>
          )}
        </Async>
      </Card>
      {isHr && <EmployeeForm open={registering} currency={cur} onClose={() => setRegistering(false)} onSaved={() => state.reload()} />}
      {isHr && <ImportModal open={importing} onClose={() => setImporting(false)} onDone={() => state.reload()} />}
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['admin', 'hr']}>
      <EmployeesPage />
    </RequireRole>
  );
}
