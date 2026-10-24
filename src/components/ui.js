'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, Inbox, X } from 'lucide-react';
import { STATUS_LABEL } from '@/lib/format';

export function Button({ variant, size, loading, children, className = '', ...props }) {
  return (
    <button className={`btn ${variant ? `btn-${variant}` : ''} ${size ? `btn-${size}` : ''} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, tight, className = '', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${tight ? 'tight' : ''}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone, icon: Icon }) {
  return (
    <div className={`card stat ${tone ? `tone-${tone}` : ''}`}>
      <div className="stat-label">
        {Icon && <Icon size={15} />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const STATUS_COLOR = {
  present: 'green',
  approved: 'green',
  active: 'green',
  finalized: 'green',
  late: 'orange',
  pending: 'orange',
  probation: 'orange',
  draft: 'orange',
  half_day: 'purple',
  on_leave: 'purple',
  missing_checkout: 'blue',
  not_marked: 'blue',
  absent: 'red',
  rejected: 'red',
  exited: 'red',
};

export function StatusBadge({ status, children }) {
  return <span className={`badge ${STATUS_COLOR[status] || ''}`}>{children || STATUS_LABEL[status] || status}</span>;
}

export function Badge({ color, children }) {
  return <span className={`badge ${color || ''}`}>{children}</span>;
}

export function Field({ label, error, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ invalid, className = '', ...props }) {
  return <input className={`input ${invalid ? 'invalid' : ''} ${className}`} {...props} />;
}

export function Select({ invalid, className = '', children, ...props }) {
  return (
    <select className={`input ${invalid ? 'invalid' : ''} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ invalid, className = '', ...props }) {
  return <textarea className={`input ${invalid ? 'invalid' : ''} ${className}`} {...props} />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading-block">
      <span className="spinner" /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        {error.message || String(error)}
        {error.details?.length > 1 && (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {error.details.slice(0, 6).map((d, i) => (
              <li key={i}>{d.field ? `${d.field}: ` : ''}{d.reason}</li>
            ))}
          </ul>
        )}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Empty({ title = 'Nothing here yet', children, icon: Icon = Inbox }) {
  return (
    <div className="empty">
      <Icon size={34} />
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {children && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

// Renders loading / error / empty states around content.
export function Async({ state, empty, emptyTitle, children }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (empty) return <Empty title={emptyTitle} />;
  return children;
}

export function Modal({ open, title, onClose, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Table({ columns, rows, onRowClick, empty = 'No records', rowKey = (r) => r.id }) {
  if (!rows?.length) return <Empty title={empty} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key || c.label} className={c.num ? 'num' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key || c.label} className={c.num ? 'num' : ''}>
                  {c.render ? c.render(r) : r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Shows a one-time temporary password after creating or resetting a login.
export function CredentialsNotice({ credentials }) {
  if (!credentials) return null;
  return (
    <div className="alert alert-success" style={{ flexDirection: 'column' }}>
      <strong>Login created. Share these details once; the password must be changed at first sign-in.</strong>
      <div>
        Email: <code>{credentials.email}</code>
      </div>
      <div>
        Temporary password: <code>{credentials.tempPassword}</code>{' '}
        <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(credentials.tempPassword)}>
          Copy
        </button>
      </div>
    </div>
  );
}

// ---- Toasts ----
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, message, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
