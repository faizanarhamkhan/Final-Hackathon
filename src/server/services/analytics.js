import { all, get } from '../db/index.js';
import { parse, z, isoDate, optionalId } from '../lib/validate.js';
import { unprocessable } from '../lib/http.js';
import { daysBetween, dayOfWeek, weekRange, zonedNow, monthLabel, timeToSeconds } from '../lib/dates.js';
import { round2 } from '../lib/money.js';
import { ownEmployeeId } from '../lib/scope.js';
import { getSettings } from './settings.js';
import { dayStatuses, summarize, hoursBetween } from './attendance.js';
import { balances, leaveDaysByType, onLeaveOn } from './leave.js';
import { payrollTotals } from './payroll.js';
import { listAnnouncements } from './comms.js';
import { recentAudit } from './audit.js';

const GROSS_SQL = 'e.basic_salary * (1 + e.hra_pct / 100 + e.medical_pct / 100) + e.other_allowance';

const filterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  department_id: optionalId,
});

// Date range + department filters shared by every dashboard. Defaults: month to date.
export async function resolveFilters(query = {}) {
  const f = parse(filterSchema, query);
  const today = zonedNow((await getSettings()).timezone).date;
  const to = f.to || today;
  const from = f.from || `${to.slice(0, 7)}-01`;
  if (from > to) throw unprocessable('VALIDATION_ERROR', '"From" must be before "To"', [{ field: 'from', reason: 'After "to"' }]);
  if (daysBetween(from, to) > 366) throw unprocessable('VALIDATION_ERROR', 'Choose a range of one year or less', [{ field: 'from', reason: 'Range too long' }]);
  return { from, to, department_id: f.department_id ?? null, today };
}

const deptClause = (departmentId) => (departmentId ? 'AND e.department_id = ?' : '');
const deptParam = (departmentId) => (departmentId ? [Number(departmentId)] : []);

// Headcount on a date = active + probation employees employed that day.
export async function headcount(date, departmentId = null) {
  return (
    await get(
      `SELECT COUNT(*) AS n FROM employees e WHERE e.join_date <= ? AND (e.exit_date IS NULL OR e.exit_date >= ?) ${deptClause(departmentId)}`,
      date,
      date,
      ...deptParam(departmentId),
    )
  ).n;
}

export function headcountByDept(date) {
  return all(
    `SELECT d.id AS department_id, d.name AS department, COUNT(e.id) AS headcount
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id AND e.join_date <= ? AND (e.exit_date IS NULL OR e.exit_date >= ?)
      GROUP BY d.id, d.name ORDER BY d.name`,
    date,
    date,
  );
}

// Attrition = exits in period ÷ average headcount × 100
export async function attrition(from, to, departmentId = null) {
  const exits = (
    await get(`SELECT COUNT(*) AS n FROM employees e WHERE e.exit_date BETWEEN ? AND ? ${deptClause(departmentId)}`, from, to, ...deptParam(departmentId))
  ).n;
  const avg = ((await headcount(from, departmentId)) + (await headcount(to, departmentId))) / 2;
  return { exits, average_headcount: round2(avg), rate: avg ? round2((exits / avg) * 100) : 0 };
}

export async function lateComers({ from, to, department_id }, limit = 5) {
  return all(
    `SELECT e.id AS employee_id, e.code, e.first_name || ' ' || e.last_name AS name, d.name AS department, COUNT(*) AS late_count
       FROM attendance a JOIN employees e ON e.id = a.employee_id LEFT JOIN departments d ON d.id = e.department_id
      WHERE a.is_late AND a.date BETWEEN ? AND ? ${deptClause(department_id)}
      GROUP BY e.id, e.code, e.first_name, e.last_name, d.name
      ORDER BY late_count DESC, name LIMIT ?`,
    from,
    to,
    ...deptParam(department_id),
    limit,
  );
}

export async function attendanceSummary({ from, to, department_id, employee_id }) {
  const rows = await dayStatuses({ from, to, departmentId: department_id, employeeId: employee_id });
  return { from, to, ...summarize(rows) };
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function trendFrom(rows) {
  return [...groupBy(rows, 'date').entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => {
      const s = summarize(list);
      return { date, rate: s.attendance_rate, present: s.counts.present + s.counts.late, late: s.counts.late, absent: s.counts.absent, on_leave: s.counts.on_leave };
    })
    .filter((t) => t.rate !== null || t.on_leave);
}

function byDeptFrom(rows) {
  return [...groupBy(rows, 'department').entries()].map(([department, list]) => {
    const s = summarize(list);
    return {
      department: department || 'Unassigned',
      absent_days: s.counts.absent,
      expected_days: s.expected_days,
      absenteeism_pct: s.absenteeism_pct ?? 0,
      late_pct: s.late_pct ?? 0,
      attendance_rate: s.attendance_rate,
    };
  });
}

// Leave utilization = approved days ÷ quota, per leave type and department (calendar year of `to`).
export async function leaveUtilization(year, departmentId = null) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const types = await leaveDaysByType(from, to, { departmentId });
  const people = await headcount(zonedNow((await getSettings()).timezone).date, departmentId);
  return types.map((t) => ({
    code: t.code,
    name: t.name,
    days: t.days,
    quota_total: t.yearly_quota == null ? null : t.yearly_quota * people,
    utilization_pct: t.yearly_quota && people ? round2((t.days / (t.yearly_quota * people)) * 100) : null,
  }));
}

// Bonus insights: absence anomaly flags + a simple, explainable attrition-risk score.
async function insightsFrom(rows, { to }) {
  const perEmp = [...groupBy(rows, 'employee_id').values()].map((list) => ({ e: list[0], s: summarize(list), list }));
  const totalAbsent = perEmp.reduce((n, p) => n + p.s.counts.absent, 0);
  const avgAbsent = perEmp.length ? totalAbsent / perEmp.length : 0;
  const ids = perEmp.map((p) => p.e.employee_id);
  const meta = new Map(
    ids.length
      ? (await all(`SELECT id, status, join_date FROM employees WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)).map((r) => [r.id, r])
      : [],
  );

  const anomalies = [];
  const risks = [];
  for (const { e, s, list } of perEmp) {
    const absent = s.counts.absent;
    const reasons = [];
    if (absent >= 3) reasons.push(`${absent} absent days`);
    else if (absent >= 2 && avgAbsent > 0 && absent >= 2 * avgAbsent) reasons.push(`${absent} absences, ${round2(absent / avgAbsent)}x the team average`);
    const aroundWeekend = list.filter((d) => d.status === 'absent' && [1, 5].includes(dayOfWeek(d.date))).length;
    if (aroundWeekend >= 2) reasons.push(`${aroundWeekend} absences on Mondays/Fridays`);
    if (s.late_arrivals >= 3) reasons.push(`${s.late_arrivals} late arrivals`);
    if (reasons.length) anomalies.push({ employee_id: e.employee_id, name: e.name, department: e.department, reasons });

    const m = meta.get(e.employee_id) || {};
    const tenureDays = m.join_date ? daysBetween(m.join_date, to) : 9999;
    // Weighted, capped factors so the score stays explainable to HR.
    let score = 0;
    const why = [];
    const add = (points, reason) => {
      score += points;
      if (reason) why.push(reason);
    };
    if (s.absenteeism_pct) add(Math.min(40, s.absenteeism_pct * 0.8), s.absenteeism_pct >= 10 ? `absenteeism ${s.absenteeism_pct}%` : null);
    if (s.late_pct) add(Math.min(20, s.late_pct * 0.3), s.late_pct >= 20 ? `late on ${s.late_pct}% of days` : null);
    const unpaid = list.filter((d) => d.status === 'on_leave' && !d.leave_paid).length;
    if (unpaid) add(Math.min(10, unpaid * 5), `${unpaid} unpaid leave day(s)`);
    if (m.status === 'probation') add(10, 'on probation');
    if (tenureDays < 90) add(10, 'joined under 90 days ago');
    score = Math.round(Math.min(100, score));
    if (score > 0) risks.push({ employee_id: e.employee_id, name: e.name, department: e.department, score, level: score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low', reasons: why });
  }
  risks.sort((a, b) => b.score - a.score);
  return { anomalies: anomalies.slice(0, 10), attrition_risk: risks.slice(0, 5) };
}

export async function pendingApprovals() {
  const leave = (await get("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'")).n;
  const corrections = (await get("SELECT COUNT(*) AS n FROM attendance_corrections WHERE status = 'pending'")).n;
  return { leave, corrections, total: leave + corrections };
}

async function todaySnapshot(today, departmentId) {
  const rows = await dayStatuses({ from: today, to: today, departmentId });
  const s = summarize(rows);
  return {
    date: today,
    present: s.counts.present + s.counts.late + s.counts.half_day + s.counts.missing_checkout,
    late: s.late_arrivals,
    on_leave: s.counts.on_leave,
    not_marked: rows.filter((r) => r.status === 'not_marked').length,
    on_leave_list: (await onLeaveOn(today, departmentId)).map((l) => ({ name: l.name, type: l.type_name, department: l.department })),
  };
}

export async function hrDashboard(query) {
  const f = await resolveFilters(query);
  const rows = await dayStatuses({ from: f.from, to: f.to, departmentId: f.department_id });
  return {
    filters: f,
    kpis: {
      headcount: await headcount(f.today, f.department_id),
      today: await todaySnapshot(f.today, f.department_id),
      pending_approvals: await pendingApprovals(),
    },
    attendance: summarize(rows),
    trend: trendFrom(rows),
    by_department: byDeptFrom(rows),
    leave_by_type: (await leaveDaysByType(f.from, f.to, { departmentId: f.department_id })).map((t) => ({ name: t.name, code: t.code, days: t.days })),
    leave_utilization: await leaveUtilization(f.to.slice(0, 4), f.department_id),
    top_late: await lateComers(f, 5),
    insights: await insightsFrom(rows, f),
    announcements: await listAnnouncements({ limit: 5 }),
  };
}

export async function adminDashboard(query) {
  const f = await resolveFilters(query);
  const rows = await dayStatuses({ from: f.from, to: f.to, departmentId: f.department_id });
  const payroll = await payrollTotals({ fromMonth: f.from.slice(0, 7), toMonth: f.to.slice(0, 7), departmentId: f.department_id });
  const sum = (k) => round2(payroll.reduce((n, r) => n + r[k], 0));
  const byMonth = new Map();
  const byDept = new Map();
  for (const r of payroll) {
    const m = byMonth.get(r.month) || { month: r.month, label: monthLabel(r.month), gross: 0, net: 0, status: r.status };
    m.gross = round2(m.gross + r.gross);
    m.net = round2(m.net + r.net);
    byMonth.set(r.month, m);
    const dname = r.department || 'Unassigned';
    const d = byDept.get(dname) || { department: dname, gross: 0, net: 0 };
    d.gross = round2(d.gross + r.gross);
    d.net = round2(d.net + r.net);
    byDept.set(dname, d);
  }
  const current = `e.join_date <= ? AND (e.exit_date IS NULL OR e.exit_date >= ?) ${deptClause(f.department_id)}`;
  const cp = [f.to, f.to, ...deptParam(f.department_id)];
  const avgSalary = await get(`SELECT ROUND(AVG(${GROSS_SQL}), 2) AS avg FROM employees e WHERE ${current}`, ...cp);
  const avgByDept = await all(
    `SELECT COALESCE(d.name, 'Unassigned') AS department, ROUND(AVG(${GROSS_SQL}), 2) AS avg_gross, COUNT(*) AS headcount
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE ${current} GROUP BY d.name ORDER BY d.name`,
    ...cp,
  );
  const avgByDesignation = await all(
    `SELECT COALESCE(g.name, 'Unassigned') AS designation, ROUND(AVG(${GROSS_SQL}), 2) AS avg_gross, COUNT(*) AS headcount
       FROM employees e LEFT JOIN designations g ON g.id = e.designation_id WHERE ${current} GROUP BY g.name ORDER BY avg_gross DESC`,
    ...cp,
  );
  const gender = await all(`SELECT COALESCE(e.gender, 'unspecified') AS gender, COUNT(*) AS count FROM employees e WHERE ${current} GROUP BY 1 ORDER BY 1`, ...cp);
  const tenure = await all(
    `SELECT bucket, COUNT(*) AS count FROM (
       SELECT CASE WHEN (?::date - e.join_date) < 90 THEN '< 3 months'
                   WHEN (?::date - e.join_date) < 365 THEN '3-12 months'
                   WHEN (?::date - e.join_date) < 1095 THEN '1-3 years'
                   ELSE '3+ years' END AS bucket
         FROM employees e WHERE ${current}) t
      GROUP BY bucket`,
    f.to,
    f.to,
    f.to,
    ...cp,
  );
  const order = ['< 3 months', '3-12 months', '1-3 years', '3+ years'];
  return {
    filters: f,
    kpis: {
      headcount: await headcount(f.to, f.department_id),
      attrition_ytd: await attrition(`${f.to.slice(0, 4)}-01-01`, f.to, f.department_id),
      payroll_cost: { gross: sum('gross'), net: sum('net'), tax: sum('tax'), months: byMonth.size },
      avg_salary: avgSalary?.avg ?? 0,
      pending_approvals: await pendingApprovals(),
    },
    attendance: summarize(rows),
    headcount_by_dept: (await headcountByDept(f.to)).filter((d) => !f.department_id || d.department_id === f.department_id),
    payroll_by_month: [...byMonth.values()],
    payroll_by_dept: [...byDept.values()],
    avg_salary_by_dept: avgByDept,
    avg_salary_by_designation: avgByDesignation,
    gender,
    tenure: order.map((b) => ({ bucket: b, count: tenure.find((t) => t.bucket === b)?.count || 0 })),
    audit_feed: await recentAudit(8),
    announcements: await listAnnouncements({ limit: 5 }),
  };
}

export async function employeeDashboard(actor) {
  const employeeId = ownEmployeeId(actor);
  const s = await getSettings();
  const now = zonedNow(s.timezone);
  const week = weekRange(now.date);
  const monthStart = `${now.month}-01`;
  const todayRec = await get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', employeeId, now.date);
  let hoursWeek = await hoursBetween(employeeId, week.start, week.end);
  // Count the open shift so far, so the widget moves during the day.
  if (todayRec && !todayRec.check_out) hoursWeek = round2(hoursWeek + Math.max(0, timeToSeconds(now.time) - timeToSeconds(todayRec.check_in)) / 3600);
  const monthRows = await dayStatuses({ from: monthStart, to: now.date, employeeId });
  const lastPayslip = await get(
    `SELECT p.id, p.net, p.gross, p.tax, p.deductions, r.month FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.employee_id = ? AND r.status = 'finalized' ORDER BY r.month DESC LIMIT 1`,
    employeeId,
  );
  return {
    today: { date: now.date, server_time: now.time, record: todayRec || null, camera_enabled: s.office_lat != null },
    hours_this_week: hoursWeek,
    hours_target: 40,
    week,
    month: summarize(monthRows),
    late_count_month: monthRows.filter((r) => r.is_late).length,
    balances: await balances(employeeId, now.date.slice(0, 4)),
    last_payslip: lastPayslip ? { ...lastPayslip, label: monthLabel(lastPayslip.month) } : null,
    announcements: await listAnnouncements({ limit: 5 }),
  };
}
