import { all, get } from '../../db/index.js';
import { addDays, isISODate, monthRange, weekRange, zonedNow, monthLabel } from '../../lib/dates.js';
import { HttpError } from '../../lib/http.js';
import { getSettings } from '../settings.js';
import { findDepartmentByName } from '../org.js';
import { attendanceSummary, headcount, headcountByDept, lateComers } from '../analytics.js';
import { balances, checkLeaveRequest, leaveDaysByType, listRequests, onLeaveOn } from '../leave.js';
import { listEmployees } from '../employees.js';
import { listPayslips, payrollTotals } from '../payroll.js';

/**
 * Tools the model may call. Each runs with the signed-in user's role and data scope,
 * through the same services the REST API uses. Tools never write to the database.
 */

const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year'];

async function resolvePeriod({ period, from, to } = {}) {
  const today = zonedNow((await getSettings()).timezone).date;
  if (isISODate(from) && isISODate(to) && from <= to) return { from, to };
  if (isISODate(from) && !to) return { from, to: from };
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week':
      return { from: weekRange(today).start, to: today };
    case 'last_week': {
      const w = weekRange(addDays(weekRange(today).start, -1));
      return { from: w.start, to: w.end };
    }
    case 'last_month': {
      const prev = monthRange(addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7));
      return { from: prev.start, to: prev.end };
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

async function resolveDept(name) {
  if (!name) return { id: null, name: null };
  const d = await findDepartmentByName(name);
  if (!d) {
    const known = (await all('SELECT name FROM departments ORDER BY name')).map((r) => r.name);
    throw new HttpError(404, 'UNKNOWN_DEPARTMENT', `No department called "${name}". Departments: ${known.join(', ') || 'none yet'}`);
  }
  return { id: d.id, name: d.name };
}

async function resolveEmployee(query) {
  const { rows } = await listEmployees({ search: query, pageSize: 5 });
  if (!rows.length) throw new HttpError(404, 'UNKNOWN_EMPLOYEE', `No employee matches "${query}"`);
  return rows[0];
}

const periodProps = {
  period: { type: 'string', enum: PERIODS, description: 'Relative period. Default this_month.' },
  from: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
  to: { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
};
const deptProp = { department: { type: 'string', description: 'Department name (optional)' } };

const ALL = ['admin', 'hr', 'employee'];
const STAFF = ['admin', 'hr'];

export const TOOLS = [
  {
    name: 'get_headcount',
    roles: STAFF,
    description: 'Number of active employees (active + probation), optionally for one department, with a per-department breakdown.',
    parameters: { type: 'object', properties: { ...deptProp, date: { type: 'string', description: 'As-of date YYYY-MM-DD, default today' } } },
    async run(actor, args) {
      const date = isISODate(args.date) ? args.date : zonedNow((await getSettings()).timezone).date;
      const dept = await resolveDept(args.department);
      return {
        as_of: date,
        department: dept.name || 'All departments',
        active_employees: await headcount(date, dept.id),
        by_department: dept.id ? undefined : (await headcountByDept(date)).map((d) => ({ department: d.department, headcount: d.headcount })),
      };
    },
  },
  {
    name: 'get_attendance_summary',
    roles: ALL,
    description:
      'Attendance counts and attendance rate for a period (same formula as the dashboard). Employees always get only their own attendance.',
    parameters: { type: 'object', properties: { ...periodProps, ...deptProp, employee: { type: 'string', description: 'Employee name or code (Admin/HR only)' } } },
    async run(actor, args) {
      const range = await resolvePeriod(args);
      let employeeId = null;
      let who = 'All employees';
      let dept = { id: null, name: null };
      if (actor.role === 'employee') {
        employeeId = actor.employee_id;
        who = actor.name;
      } else {
        dept = await resolveDept(args.department);
        if (args.employee) {
          const e = await resolveEmployee(args.employee);
          employeeId = e.id;
          who = e.full_name;
        }
      }
      const s = await attendanceSummary({ ...range, department_id: dept.id, employee_id: employeeId });
      return {
        scope: who,
        department: dept.name || undefined,
        from: s.from,
        to: s.to,
        attendance_rate_pct: s.attendance_rate,
        counts: s.counts,
        late_arrivals: s.late_arrivals,
        absenteeism_pct: s.absenteeism_pct,
        formula: '(present + late + missing_checkout + 0.5 x half_day) / (working-day records - on_leave)',
      };
    },
  },
  {
    name: 'get_late_comers',
    roles: STAFF,
    description: 'Employees ranked by number of late check-ins in a period (default this month).',
    parameters: { type: 'object', properties: { ...periodProps, ...deptProp, limit: { type: 'integer', description: 'Max rows, default 5' } } },
    async run(actor, args) {
      const range = await resolvePeriod(args);
      const dept = await resolveDept(args.department);
      const rows = await lateComers({ ...range, department_id: dept.id }, Math.min(20, Number(args.limit) || 5));
      return { ...range, department: dept.name || 'All departments', late_comers: rows.map((r) => ({ name: r.name, code: r.code, department: r.department, late_count: r.late_count })) };
    },
  },
  {
    name: 'get_leave_summary',
    roles: ALL,
    description:
      'Who is on approved leave on a date (default today) and approved leave days by type for a period. Employees only get their own leave.',
    parameters: { type: 'object', properties: { date: { type: 'string', description: 'Date YYYY-MM-DD for "who is on leave", default today' }, ...periodProps, ...deptProp } },
    async run(actor, args) {
      const today = zonedNow((await getSettings()).timezone).date;
      const date = isISODate(args.date) ? args.date : today;
      const range = await resolvePeriod(args);
      if (actor.role === 'employee') {
        const mine = await listRequests(actor, { from: range.from, to: range.to });
        return {
          scope: 'Your own leave only',
          on_leave_on_date: (await onLeaveOn(date)).some((l) => l.employee_id === actor.employee_id),
          requests: mine.map((r) => ({ type: r.type_name, start: r.start_date, end: r.end_date, days: r.days, status: r.status })),
        };
      }
      const dept = await resolveDept(args.department);
      const list = await onLeaveOn(date, dept.id);
      const byType = {};
      for (const l of list) byType[l.type_name] = (byType[l.type_name] || 0) + 1;
      const pending = (await get("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'")).n;
      return {
        date,
        department: dept.name || 'All departments',
        on_leave_count: list.length,
        on_leave_by_type: byType,
        on_leave: list.map((l) => ({ name: l.name, department: l.department, type: l.type_name, from: l.start_date, to: l.end_date })),
        approved_days_by_type: { ...range, types: (await leaveDaysByType(range.from, range.to, { departmentId: dept.id })).map((t) => ({ type: t.name, days: t.days })) },
        pending_requests: pending,
      };
    },
  },
  {
    name: 'get_my_leave_balance',
    roles: ALL,
    description: "The signed-in user's own leave balance per type for a year: quota, used (approved), pending and remaining.",
    parameters: { type: 'object', properties: { year: { type: 'integer' }, type: { type: 'string', description: 'Leave type code e.g. sick, casual, annual' } } },
    async run(actor, args) {
      if (!actor.employee_id) return { error: 'This login has no employee profile, so there is no personal leave balance.' };
      const list = await balances(actor.employee_id, args.year);
      const filtered = args.type ? list.filter((b) => b.code === String(args.type).toLowerCase() || b.name.toLowerCase().includes(String(args.type).toLowerCase())) : list;
      return {
        year: list[0]?.year,
        balances: (filtered.length ? filtered : list).map((b) => ({
          type: b.name,
          quota: b.quota ?? 'unlimited',
          used_approved: b.used,
          pending: b.pending,
          remaining: b.remaining ?? 'unlimited',
        })),
        note: 'remaining = quota - approved days; pending requests are not deducted until approved',
      };
    },
  },
  {
    name: 'get_payroll_summary',
    roles: ALL,
    description:
      "Admin/HR: payroll totals for a month (gross, net, tax, by department). Employee: only their own finalized payslips. Never use this for another employee's salary when the user is an Employee.",
    parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM, default latest' }, ...deptProp } },
    async run(actor, args) {
      if (actor.role === 'employee') {
        const slips = await listPayslips(actor, {});
        const pick = args.month ? slips.filter((p) => p.month === args.month) : slips.slice(0, 3);
        return {
          scope: 'Your own payslips only',
          payslips: pick.map((p) => ({ month: p.label, gross: p.gross, deductions: p.deductions, tax: p.tax, net: p.net, absent_days: p.absent_days })),
        };
      }
      const latest = await get('SELECT month FROM payroll_runs ORDER BY month DESC LIMIT 1');
      const month = /^\d{4}-\d{2}$/.test(args.month || '') ? args.month : latest?.month;
      if (!month) return { message: 'No payroll has been run yet.' };
      const run = await get('SELECT * FROM payroll_runs WHERE month = ?', month);
      if (!run) return { month, message: 'No payroll run exists for this month.' };
      const dept = await resolveDept(args.department);
      const rows = await payrollTotals({ fromMonth: month, toMonth: month, departmentId: dept.id });
      return {
        month: monthLabel(month),
        status: run.status,
        employees: rows.reduce((n, r) => n + r.employees, 0),
        total_gross: Math.round(rows.reduce((n, r) => n + r.gross, 0) * 100) / 100,
        total_net: Math.round(rows.reduce((n, r) => n + r.net, 0) * 100) / 100,
        total_tax: Math.round(rows.reduce((n, r) => n + r.tax, 0) * 100) / 100,
        by_department: rows.map((r) => ({ department: r.department || 'Unassigned', gross: r.gross, net: r.net, employees: r.employees })),
      };
    },
  },
  {
    name: 'search_employees',
    roles: STAFF,
    description: 'Search employees by name, code, email or phone, optionally in a department.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, ...deptProp, status: { type: 'string', enum: ['active', 'probation', 'exited'] } } },
    async run(actor, args) {
      const dept = await resolveDept(args.department);
      const res = await listEmployees({ search: args.query, department_id: dept.id, status: args.status, pageSize: 10 });
      return {
        total: res.total,
        employees: res.rows.map((e) => ({
          name: e.full_name,
          code: e.code,
          department: e.department,
          designation: e.designation,
          status: e.status,
          email: e.email,
          join_date: e.join_date,
          monthly_gross: e.salary.gross,
        })),
      };
    },
  },
  {
    name: 'draft_leave_request',
    roles: ALL,
    description:
      'Prepare (NOT submit) a leave form from what the user asked for. The user reviews and confirms it in the app. Dates YYYY-MM-DD; type is a leave type code.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Leave type code: annual, sick, casual or unpaid' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['type', 'start_date', 'end_date'],
    },
    async run(actor, args) {
      return draftLeave(actor, { type: args.type, start_date: args.start_date, end_date: args.end_date, reason: args.reason });
    },
  },
];

// Validates a leave draft with the real leave rules but never saves it.
export async function draftLeave(actor, d) {
  if (!actor.employee_id) return { ok: false, error: 'This login has no employee profile, so it cannot apply for leave.' };
  if (!isISODate(d.start_date) || !isISODate(d.end_date) || d.start_date > d.end_date) return { ok: false, error: 'Invalid dates' };
  const type = await get('SELECT id, code, name FROM leave_types WHERE (lower(code) = lower(?) OR lower(name) = lower(?)) AND is_active', d.type || '', d.type || '');
  const fallback = type || (await get("SELECT id, code, name FROM leave_types WHERE code = 'casual' AND is_active"));
  if (!fallback) return { ok: false, error: 'Unknown leave type' };
  const draft = {
    leave_type_id: fallback.id,
    type: fallback.code,
    type_name: fallback.name,
    start_date: d.start_date,
    end_date: d.end_date,
    reason: (d.reason || 'Personal').slice(0, 300),
  };
  const warnings = [];
  let days = null;
  try {
    const checked = await checkLeaveRequest(actor.employee_id, draft);
    days = checked.days;
  } catch (e) {
    if (e instanceof HttpError) warnings.push(e.message);
    else throw e;
  }
  return { ok: true, submitted: false, draft: { ...draft, days }, warnings, note: 'Draft only. The user must confirm the form to submit it.' };
}

export const toolsFor = (actor) => TOOLS.filter((t) => t.roles.includes(actor.role));

export function toolSchemas(actor) {
  return toolsFor(actor).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

export async function runTool(actor, name, args) {
  const tool = toolsFor(actor).find((t) => t.name === name);
  if (!tool) return { error: `Tool ${name} is not available for the ${actor.role} role.` };
  try {
    return await tool.run(actor, args || {});
  } catch (e) {
    if (e instanceof HttpError) return { error: e.message };
    throw e;
  }
}
