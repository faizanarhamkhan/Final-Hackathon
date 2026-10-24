const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return `${DAYS[dt.getUTCDay()]} ${day} ${MONTHS[m - 1]} ${y}`;
}

export const fmtShortDate = (d) => {
  if (!d) return '—';
  const [, m, day] = d.slice(0, 10).split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}`;
};

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  return dt.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const fmtTime = (t) => (t ? t.slice(0, 5) : '—');

export function fmtMoney(n, currency = 'PKR') {
  if (n == null) return '—';
  return `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export const fmtNum = (n, digits = 0) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: digits }));
export const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);

export function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const STATUS_LABEL = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half day',
  missing_checkout: 'Missing checkout',
  absent: 'Absent',
  on_leave: 'On leave',
  not_marked: 'Not marked',
  upcoming: 'Upcoming',
  off: 'Off',
  not_employed: '—',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  draft: 'Draft',
  finalized: 'Finalized',
  active: 'Active',
  probation: 'Probation',
  exited: 'Exited',
};

export const titleCase = (s) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
