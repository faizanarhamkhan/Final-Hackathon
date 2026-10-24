import { all, get, run, tx, nowIso } from '../db/index.js';
import { parse, z, month as monthSchema } from '../lib/validate.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/http.js';
import { monthRange, monthLabel, maxDate, minDate, zonedNow } from '../lib/dates.js';
import { annualTax, round2 } from '../lib/money.js';
import { scopedEmployeeId } from '../lib/scope.js';
import { getSettings, workCalendar } from './settings.js';
import { dayStatuses } from './attendance.js';
import { audit } from './audit.js';
import { notifyEmployee } from './comms.js';

/**
 * Payroll rules (brief, section 3):
 *   gross      = basic + HRA (40%) + medical (10%) (+ other allowance) = 1.5 × basic by default
 *   per day    = gross ÷ working days in the month
 *   deductions = per day × (absent + unpaid leave + 0.5 × half days [+ late penalty])
 *   joiners / leavers are prorated by the working days they were employed
 *   tax        = slab on (prorated gross × 12) ÷ 12
 */
export async function computePayslip(emp, month, settings) {
  const s = settings || (await getSettings());
  const { start, end } = monthRange(month);
  const from = maxDate(start, emp.join_date);
  const to = minDate(end, emp.exit_date || end);
  if (from > to) return null;

  const cal = await workCalendar(start, end);
  const workingDays = cal.workingDays(start, end);
  const employedDays = cal.workingDays(from, to);

  const basic = emp.basic_salary;
  const hra = round2((basic * emp.hra_pct) / 100);
  const medical = round2((basic * emp.medical_pct) / 100);
  const other = emp.other_allowance || 0;
  const monthlyGross = round2(basic + hra + medical + other);
  const perDay = workingDays ? monthlyGross / workingDays : 0;

  const days = await dayStatuses({ from, to, employeeId: emp.id });
  const absent = days.filter((d) => d.status === 'absent').length;
  const halfDays = days.filter((d) => d.status === 'half_day').length;
  const unpaid = days.filter((d) => d.status === 'on_leave' && !d.leave_paid).length;
  const lateCount = days.filter((d) => d.is_late).length;
  // Bonus rule: every 3 late arrivals cost half a day (Admin can switch it on).
  const latePenaltyDays = s.late_penalty_enabled ? Math.floor(lateCount / 3) * 0.5 : 0;

  const gross = round2(perDay * employedDays);
  const deductionDays = absent + unpaid + 0.5 * halfDays + latePenaltyDays;
  const deductions = round2(Math.min(gross, perDay * deductionDays));
  const taxableAnnual = round2(gross * 12);
  const tax = round2(annualTax(taxableAnnual) / 12);
  const net = round2(Math.max(0, gross - deductions - tax));

  return {
    employee_id: emp.id,
    department_id: emp.department_id,
    designation_id: emp.designation_id,
    basic,
    hra,
    medical,
    other_allowance: other,
    monthly_gross: monthlyGross,
    working_days: workingDays,
    employed_days: employedDays,
    absent_days: absent,
    unpaid_leave_days: unpaid,
    half_days: halfDays,
    late_count: lateCount,
    late_penalty_days: latePenaltyDays,
    per_day: round2(perDay),
    gross,
    deductions,
    taxable_annual: taxableAnnual,
    tax,
    net,
  };
}

const PAYSLIP_COLS = [
  'employee_id', 'department_id', 'designation_id', 'basic', 'hra', 'medical', 'other_allowance', 'monthly_gross',
  'working_days', 'employed_days', 'absent_days', 'unpaid_leave_days', 'half_days', 'late_count', 'late_penalty_days',
  'per_day', 'gross', 'deductions', 'taxable_annual', 'tax', 'net',
];

const SELECT_RUN = `
  SELECT r.*, c.name AS created_by_name, f.name AS finalized_by_name
    FROM payroll_runs r LEFT JOIN users c ON c.id = r.created_by LEFT JOIN users f ON f.id = r.finalized_by`;

const getRun = (id) => get(`${SELECT_RUN} WHERE r.id = ?`, id);

export async function listRuns() {
  return (await all(`${SELECT_RUN} ORDER BY r.month DESC`)).map((r) => ({ ...r, label: monthLabel(r.month) }));
}

// HR creates the draft; running it again recalculates the draft. Finalized months are locked.
export async function createOrRecalculate(actor, input) {
  const { month } = parse(z.object({ month: monthSchema }), input);
  const settings = await getSettings();
  if (month > zonedNow(settings.timezone).month) throw unprocessable('FUTURE_MONTH', 'Payroll cannot be run for a future month');
  return tx(async () => {
    let runRow = await get('SELECT * FROM payroll_runs WHERE month = ? FOR UPDATE', month);
    if (runRow?.status === 'finalized') throw conflict('PAYROLL_LOCKED', `${monthLabel(month)} payroll is finalized and locked`);
    const { start, end } = monthRange(month);
    const workingDays = (await workCalendar(start, end)).workingDays(start, end);
    const before = runRow ? { ...runRow } : null;
    if (runRow) await run('DELETE FROM payslips WHERE run_id = ?', runRow.id);
    else runRow = await get('INSERT INTO payroll_runs (month, working_days, created_by) VALUES (?, ?, ?) RETURNING *', month, workingDays, actor.id);

    const emps = await all('SELECT * FROM employees WHERE join_date <= ? AND (exit_date IS NULL OR exit_date >= ?) ORDER BY code', end, start);
    const totals = { count: 0, gross: 0, deductions: 0, tax: 0, net: 0 };
    for (const e of emps) {
      const slip = await computePayslip(e, month, settings);
      if (!slip) continue;
      await run(
        `INSERT INTO payslips (run_id, ${PAYSLIP_COLS.join(', ')}) VALUES (?, ${PAYSLIP_COLS.map(() => '?').join(', ')})`,
        runRow.id,
        ...PAYSLIP_COLS.map((c) => slip[c]),
      );
      totals.count++;
      totals.gross += slip.gross;
      totals.deductions += slip.deductions;
      totals.tax += slip.tax;
      totals.net += slip.net;
    }
    await run(
      `UPDATE payroll_runs SET working_days = ?, employee_count = ?, total_gross = ?, total_deductions = ?, total_tax = ?, total_net = ?,
              created_by = ?, updated_at = ? WHERE id = ?`,
      workingDays,
      totals.count,
      round2(totals.gross),
      round2(totals.deductions),
      round2(totals.tax),
      round2(totals.net),
      actor.id,
      nowIso(),
      runRow.id,
    );
    await audit(actor, before ? 'payroll.recalculate' : 'payroll.create_draft', 'payroll_run', runRow.id, before, await getRun(runRow.id));
    return getRunDetail(actor, runRow.id);
  });
}

export async function getRunDetail(actor, id) {
  const r = await getRun(id);
  if (!r) throw notFound('Payroll run not found');
  const payslips = await all(
    `SELECT p.*, e.code, e.first_name || ' ' || e.last_name AS name, d.name AS department, g.name AS designation
       FROM payslips p JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = p.department_id LEFT JOIN designations g ON g.id = p.designation_id
      WHERE p.run_id = ? ORDER BY e.code`,
    id,
  );
  return { ...r, label: monthLabel(r.month), payslips };
}

// Only Admin finalizes; afterwards the run and its payslips are locked (service + DB trigger).
export async function finalizeRun(actor, id) {
  return tx(async () => {
    const r = await get(`${SELECT_RUN} WHERE r.id = ? FOR UPDATE OF r`, id);
    if (!r) throw notFound('Payroll run not found');
    if (r.status === 'finalized') throw conflict('PAYROLL_LOCKED', 'This payroll run is already finalized');
    if (!r.employee_count) throw unprocessable('EMPTY_RUN', 'There are no payslips in this run');
    await run("UPDATE payroll_runs SET status = 'finalized', finalized_by = ?, finalized_at = ?, updated_at = ? WHERE id = ?", actor.id, nowIso(), nowIso(), id);
    await audit(actor, 'payroll.finalize', 'payroll_run', id, r, await getRun(id));
    for (const p of await all('SELECT employee_id FROM payslips WHERE run_id = ?', id)) {
      await notifyEmployee(p.employee_id, `Payslip for ${monthLabel(r.month)} is ready`, 'Download it from My payslips.', '/my/payslips');
    }
    return getRunDetail(actor, id);
  });
}

export async function deleteDraft(actor, id) {
  return tx(async () => {
    const r = await getRun(id);
    if (!r) throw notFound('Payroll run not found');
    if (r.status === 'finalized') throw conflict('PAYROLL_LOCKED', 'A finalized payroll run cannot be deleted');
    await run('DELETE FROM payslips WHERE run_id = ?', id);
    await run('DELETE FROM payroll_runs WHERE id = ?', id);
    await audit(actor, 'payroll.delete_draft', 'payroll_run', id, r, null);
    return { ok: true };
  });
}

// Employees only ever see their own finalized payslips.
export async function listPayslips(actor, { employee_id, run_id } = {}) {
  const employeeId = scopedEmployeeId(actor, employee_id);
  const where = [];
  const params = [];
  if (employeeId) (where.push('p.employee_id = ?'), params.push(employeeId));
  if (run_id) (where.push('p.run_id = ?'), params.push(Number(run_id)));
  if (actor.role === 'employee') where.push("r.status = 'finalized'");
  return (
    await all(
      `SELECT p.*, r.month, r.status AS run_status, e.code, e.first_name || ' ' || e.last_name AS name, d.name AS department
         FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
         LEFT JOIN departments d ON d.id = p.department_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.month DESC, e.code LIMIT 500`,
      ...params,
    )
  ).map((p) => ({ ...p, label: monthLabel(p.month) }));
}

export async function getPayslip(actor, id) {
  const p = await get(
    `SELECT p.*, r.month, r.status AS run_status, e.code, e.first_name || ' ' || e.last_name AS name, e.email, e.join_date,
            d.name AS department, g.name AS designation
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = p.department_id LEFT JOIN designations g ON g.id = p.designation_id
      WHERE p.id = ?`,
    id,
  );
  if (!p) throw notFound('Payslip not found');
  if (actor.role === 'employee') {
    if (p.employee_id !== actor.employee_id) throw forbidden('You can only see your own payslips');
    if (p.run_status !== 'finalized') throw notFound('Payslip not found');
  }
  return { ...p, label: monthLabel(p.month) };
}

// Payroll cost by month and department (database aggregation).
export async function payrollTotals({ fromMonth, toMonth, departmentId = null }) {
  return all(
    `SELECT r.month, r.status, p.department_id, d.name AS department,
            ROUND(SUM(p.gross), 2) AS gross, ROUND(SUM(p.net), 2) AS net, ROUND(SUM(p.tax), 2) AS tax,
            ROUND(SUM(p.deductions), 2) AS deductions, COUNT(*) AS employees
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id LEFT JOIN departments d ON d.id = p.department_id
      WHERE r.month BETWEEN ? AND ? ${departmentId ? 'AND p.department_id = ?' : ''}
      GROUP BY r.month, r.status, p.department_id, d.name ORDER BY r.month`,
    fromMonth,
    toMonth,
    ...(departmentId ? [Number(departmentId)] : []),
  );
}
