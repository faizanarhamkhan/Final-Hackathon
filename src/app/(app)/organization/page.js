'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Table, Tabs, useToast } from '@/components/ui';

// Generic create/edit modal for the small org tables.
function EditModal({ open, title, fields, initial, onClose, onSubmit }) {
  const [form, setForm] = useState(initial || {});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setForm(initial || {});
    setErrors({});
    setError(null);
  }
  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await onSubmit(form);
      onClose();
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
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        {fields.map((f) => (
          <Field key={f.key} label={f.label} error={errors[f.key]} hint={f.hint}>
            {f.type === 'select' ? (
              <Select value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === 'checkbox' ? (
              <label className="check">
                <input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} /> {f.checkLabel}
              </label>
            ) : (
              <Input type={f.type || 'text'} value={form[f.key] ?? ''} disabled={f.disabled && !!initial?.id} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function Section({ resource, label, columns, fields, toBody = (f) => f, canEdit, newDefaults = {} }) {
  const toast = useToast();
  const state = useApi(`org/${resource}`);
  const [editing, setEditing] = useState(null);
  async function remove(row) {
    if (!window.confirm(`Delete ${row.name || row.code}?`)) return;
    try {
      await api(`org/${resource}/${row.id}`, { method: 'DELETE' });
      toast('Deleted');
      state.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  const cols = canEdit
    ? [
        ...columns,
        {
          key: '_actions',
          label: '',
          render: (r) => (
            <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
              <Button size="sm" variant="ghost" className="icon-btn" onClick={() => setEditing(r)} aria-label="Edit" title="Edit">
                <Pencil size={14} />
              </Button>
              <Button size="sm" variant="ghost" className="icon-btn" onClick={() => remove(r)} aria-label="Delete" title="Delete">
                <Trash2 size={14} />
              </Button>
            </div>
          ),
        },
      ]
    : columns;
  return (
    <Card
      title={label}
      tight
      actions={
        canEdit && (
          <Button size="sm" variant="primary" onClick={() => setEditing({ ...newDefaults })}>
            <Plus size={14} /> Add
          </Button>
        )
      }
    >
      <Async state={state}>
        <Table columns={cols} rows={state.data} empty={`No ${label.toLowerCase()} yet`} />
      </Async>
      <EditModal
        open={!!editing}
        title={editing?.id ? `Edit ${label.replace(/s$/, '').toLowerCase()}` : `Add ${label.replace(/s$/, '').toLowerCase()}`}
        fields={fields}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (form) => {
          const body = toBody(form);
          if (editing.id) await api(`org/${resource}/${editing.id}`, { method: 'PUT', body });
          else await api(`org/${resource}`, { method: 'POST', body });
          toast('Saved');
          state.reload();
        }}
      />
    </Card>
  );
}

function OrgPage() {
  const { user } = useAuth();
  const canEdit = user.role === 'admin';
  const [tab, setTab] = useState('departments');
  const depts = useApi('org/departments');
  const deptOptions = [{ value: '', label: 'Any department' }, ...(depts.data || []).map((d) => ({ value: d.id, label: d.name }))];
  return (
    <>
      <PageHeader title="Organization" subtitle={canEdit ? 'Departments, designations, leave types and public holidays' : 'View only. Admin manages these.'} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'departments', label: 'Departments' },
          { value: 'designations', label: 'Designations' },
          { value: 'leave-types', label: 'Leave types & quotas' },
          { value: 'holidays', label: 'Public holidays' },
        ]}
      />
      {tab === 'departments' && (
        <Section
          resource="departments"
          label="Departments"
          canEdit={canEdit}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'employee_count', label: 'Employees', num: true },
          ]}
          fields={[{ key: 'name', label: 'Department name' }]}
        />
      )}
      {tab === 'designations' && (
        <Section
          resource="designations"
          label="Designations"
          canEdit={canEdit}
          columns={[
            { key: 'name', label: 'Title' },
            { key: 'department', label: 'Department', render: (r) => r.department || 'Any' },
            { key: 'employee_count', label: 'Employees', num: true },
          ]}
          fields={[
            { key: 'name', label: 'Designation' },
            { key: 'department_id', label: 'Department', type: 'select', options: deptOptions },
          ]}
          toBody={(f) => ({ name: f.name, department_id: f.department_id || undefined })}
        />
      )}
      {tab === 'leave-types' && (
        <Section
          resource="leave-types"
          label="Leave types"
          canEdit={canEdit}
          newDefaults={{ is_paid: true, is_active: true }}
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'code', label: 'Code', render: (r) => <code>{r.code}</code> },
            { key: 'yearly_quota', label: 'Yearly quota', num: true, render: (r) => (r.yearly_quota == null ? 'Unlimited' : `${r.yearly_quota} days`) },
            { key: 'is_paid', label: 'Paid', render: (r) => (r.is_paid ? <Badge color="green">Paid</Badge> : <Badge color="orange">Unpaid</Badge>) },
            { key: 'is_active', label: 'Status', render: (r) => (r.is_active ? 'Active' : 'Inactive') },
          ]}
          fields={[
            { key: 'name', label: 'Name' },
            { key: 'code', label: 'Code', hint: 'e.g. annual, sick, casual', disabled: true },
            { key: 'yearly_quota', label: 'Yearly quota (days)', type: 'number', hint: 'Leave empty for unlimited' },
            { key: 'is_paid', label: 'Pay', type: 'checkbox', checkLabel: 'Paid leave (unpaid leave is deducted in payroll)' },
            { key: 'is_active', label: 'Status', type: 'checkbox', checkLabel: 'Active' },
          ]}
          toBody={(f) => ({ code: f.code, name: f.name, yearly_quota: f.yearly_quota === '' || f.yearly_quota == null ? null : Number(f.yearly_quota), is_paid: !!f.is_paid, is_active: !!f.is_active })}
        />
      )}
      {tab === 'holidays' && (
        <Section
          resource="holidays"
          label="Public holidays"
          canEdit={canEdit}
          columns={[
            { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'name', label: 'Holiday' },
          ]}
          fields={[
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'name', label: 'Name' },
          ]}
        />
      )}
    </>
  );
}

export default function Page() {
  return (
    <RequireRole roles={['admin', 'hr']}>
      <OrgPage />
    </RequireRole>
  );
}
