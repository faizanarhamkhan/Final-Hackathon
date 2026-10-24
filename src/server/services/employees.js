import { all, get, run, tx, nowIso } from '../db/index.js';
import { parse, z, isoDate, optionalId, optionalText } from '../lib/validate.js';
import { conflict, notFound, unprocessable } from '../lib/http.js';
import { isISODate } from '../lib/dates.js';
import { round2 } from '../lib/money.js';
import { readCsv, toCsv } from '../lib/csv.js';
import { assertCanSeeEmployee } from '../lib/scope.js';
import { hashPassword, tempPassword } from './passwords.js';
import { audit } from './audit.js';

const SELECT_EMPLOYEE = `
  SELECT e.*, e.first_name || ' ' || e.last_name AS full_name,
         d.name AS department, g.name AS designation,
         u.id AS user_id, u.is_active AS login_active, u.role AS login_role,
         u.must_change_password, u.last_login_at
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations g ON g.id = e.designation_id
    LEFT JOIN users u ON u.employee_id = e.id`;

export const monthlyGross = (e) => round2(e.basic_salary * (1 + e.hra_pct / 100 + e.medical_pct / 100) + (e.other_allowance || 0));

function shape(e) {
  if (!e) return e;
  return {
    ...e,
    salary: {
      basic: e.basic_salary,
      hra: round2((e.basic_salary * e.hra_pct) / 100),
      medical: round2((e.basic_salary * e.medical_pct) / 100),
      other_allowance: e.other_allowance,
      hra_pct: e.hra_pct,
      medical_pct: e.medical_pct,
      gross: monthlyGross(e),
    },
  };
}

export async function getEmployee(actor, id) {
  assertCanSeeEmployee(actor, id);
  const e = await get(`${SELECT_EMPLOYEE} WHERE e.id = ?`, Number(id));
  if (!e) throw notFound('Employee not found');
  return shape(e);
}

const SORTS = {
  name: 'e.first_name, e.last_name',
  code: 'e.code',
  join_date: 'e.join_date DESC',
  department: 'd.name, e.first_name',
};

export async function listEmployees({ search, department_id, designation_id, status, page = 1, pageSize = 20, sort = 'name' } = {}) {
  const where = [];
  const params = [];
  if (search) {
    where.push("(e.first_name || ' ' || e.last_name ILIKE ? OR e.code ILIKE ? OR e.email ILIKE ? OR e.phone ILIKE ?)");
    const s = `%${String(search).trim()}%`;
    params.push(s, s, s, s);
  }
  if (department_id) (where.push('e.department_id = ?'), params.push(Number(department_id)));
  if (designation_id) (where.push('e.designation_id = ?'), params.push(Number(designation_id)));
  if (status === 'current') where.push("e.status IN ('active','probation')");
  else if (status) (where.push('e.status = ?'), params.push(status));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const p = Math.max(1, Number(page) || 1);
  const total = (await get(`SELECT COUNT(*) AS n FROM employees e LEFT JOIN departments d ON d.id = e.department_id ${clause}`, ...params)).n;
  const rows = (await all(`${SELECT_EMPLOYEE} ${clause} ORDER BY ${SORTS[sort] || SORTS.name} LIMIT ? OFFSET ?`, ...params, size, (p - 1) * size)).map(shape);
  return { rows, total, page: p, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) };
}

const nullableEnum = (values) => z.preprocess((v) => (v === '' ? null : v), z.enum(values).nullable().optional());

const baseFields = {
  code: z.string().trim().min(1, 'Code is required').max(20).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, - or _'),
  first_name: z.string().trim().min(1, 'First name is required').max(60),
  last_name: z.string().trim().min(1, 'Last name is required').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: optionalText(30),
  address: optionalText(300),
  gender: nullableEnum(['male', 'female', 'other']),
  dob: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional()),
  department_id: z.coerce.number({ invalid_type_error: 'Department is required' }).int().positive('Department is required'),
  designation_id: optionalId,
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'intern']).default('full_time'),
  status: z.enum(['active', 'probation']).default('active'),
  join_date: isoDate,
  basic_salary: z.coerce.number().positive('Salary must be greater than 0'),
  hra_pct: z.coerce.number().min(0).max(200).default(40),
  medical_pct: z.coerce.number().min(0).max(200).default(10),
  other_allowance: z.coerce.number().min(0).default(0),
};
const createSchema = z.object(baseFields);

async function checkRefs(data) {
  if (data.department_id && !(await get('SELECT 1 FROM departments WHERE id = ?', data.department_id))) {
    throw unprocessable('VALIDATION_ERROR', 'Unknown department', [{ field: 'department_id', reason: 'Unknown department' }]);
  }
  if (data.designation_id) {
    const g = await get('SELECT * FROM designations WHERE id = ?', data.designation_id);
    if (!g) throw unprocessable('VALIDATION_ERROR', 'Unknown designation', [{ field: 'designation_id', reason: 'Unknown designation' }]);
    if (g.department_id && data.department_id && g.department_id !== data.department_id) {
      throw unprocessable('VALIDATION_ERROR', 'This designation belongs to another department', [
        { field: 'designation_id', reason: 'Belongs to another department' },
      ]);
    }
  }
}

async function checkUnique(data, exceptId = null) {
  if (data.code && (await get('SELECT 1 FROM employees WHERE lower(code) = lower(?) AND id IS DISTINCT FROM ?', data.code, exceptId))) {
    throw conflict('DUPLICATE_CODE', `Employee code ${data.code} is already used`);
  }
  if (data.email) {
    if (await get('SELECT 1 FROM employees WHERE lower(email) = ? AND id IS DISTINCT FROM ?', data.email, exceptId)) {
      throw conflict('DUPLICATE_EMAIL', `${data.email} is already used by another employee`);
    }
    if (await get('SELECT 1 FROM users WHERE lower(email) = ? AND employee_id IS DISTINCT FROM ?', data.email, exceptId)) {
      throw conflict('DUPLICATE_EMAIL', `${data.email} is already used by another login`);
    }
  }
}

// Inserts the employee and their login (temporary password, changed on first sign-in).
async function insertEmployee(data, passwordHash) {
  const e = await get(
    `INSERT INTO employees (code, first_name, last_name, email, phone, address, gender, dob, department_id, designation_id,
                            employment_type, status, join_date, basic_salary, hra_pct, medical_pct, other_allowance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    data.code,
    data.first_name,
    data.last_name,
    data.email,
    data.phone ?? null,
    data.address ?? null,
    data.gender ?? null,
    data.dob ?? null,
    data.department_id,
    data.designation_id ?? null,
    data.employment_type ?? 'full_time',
    data.status ?? 'active',
    data.join_date,
    data.basic_salary,
    data.hra_pct ?? 40,
    data.medical_pct ?? 10,
    data.other_allowance ?? 0,
  );
  await run(
    "INSERT INTO users (email, password_hash, name, role, employee_id, must_change_password) VALUES (?, ?, ?, 'employee', ?, true)",
    data.email,
    passwordHash,
    `${data.first_name} ${data.last_name}`,
    e.id,
  );
  return e.id;
}

export async function createEmployee(actor, input) {
  const data = parse(createSchema, input);
  await checkRefs(data);
  const temp = tempPassword();
  const hash = await hashPassword(temp);
  return tx(async () => {
    await checkUnique(data);
    const employeeId = await insertEmployee(data, hash);
    const employee = await getEmployee(actor, employeeId);
    await audit(actor, 'employee.create', 'employee', employeeId, null, employee);
    return { employee, credentials: { email: data.email, tempPassword: temp } };
  });
}

const updateSchema = z
  .object({
    ...baseFields,
    status: z.enum(['active', 'probation', 'exited']),
    exit_date: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional()),
  })
  .partial()
  .refine((d) => d.status !== 'exited' || d.exit_date, { message: 'Exit date is required when status is exited', path: ['exit_date'] });

export async function updateEmployee(actor, id, input) {
  const data = parse(updateSchema, input);
  return tx(async () => {
    const before = await getEmployee(actor, id);
    const merged = { ...before, ...data };
    await checkRefs(merged);
    await checkUnique({ code: data.code, email: data.email }, Number(id));
    if (merged.status !== 'exited') merged.exit_date = null;
    if (merged.exit_date && merged.exit_date < merged.join_date) {
      throw unprocessable('VALIDATION_ERROR', 'Exit date cannot be before the join date', [{ field: 'exit_date', reason: 'Before join date' }]);
    }
    await run(
      `UPDATE employees SET code = ?, first_name = ?, last_name = ?, email = ?, phone = ?, address = ?, gender = ?, dob = ?,
              department_id = ?, designation_id = ?, employment_type = ?, status = ?, join_date = ?, exit_date = ?,
              basic_salary = ?, hra_pct = ?, medical_pct = ?, other_allowance = ?, updated_at = ?
        WHERE id = ?`,
      merged.code,
      merged.first_name,
      merged.last_name,
      merged.email,
      merged.phone,
      merged.address,
      merged.gender,
      merged.dob,
      merged.department_id,
      merged.designation_id,
      merged.employment_type,
      merged.status,
      merged.join_date,
      merged.exit_date,
      merged.basic_salary,
      merged.hra_pct,
      merged.medical_pct,
      merged.other_allowance,
      nowIso(),
      id,
    );
    // Keep the login in step with the employee record; leavers lose access.
    await run('UPDATE users SET email = ?, name = ? WHERE employee_id = ?', merged.email, `${merged.first_name} ${merged.last_name}`, id);
    if (before.status !== merged.status) {
      await run('UPDATE users SET is_active = ? WHERE employee_id = ?', merged.status !== 'exited', id);
    }
    const after = await getEmployee(actor, id);
    const action = merged.status === 'exited' && before.status !== 'exited' ? 'employee.exit' : 'employee.update';
    await audit(actor, action, 'employee', id, before, after);
    return after;
  });
}

const salarySchema = z.object({
  basic_salary: z.coerce.number().positive('Basic salary must be greater than 0'),
  hra_pct: z.coerce.number().min(0).max(200).default(40),
  medical_pct: z.coerce.number().min(0).max(200).default(10),
  other_allowance: z.coerce.number().min(0).default(0),
});

export async function updateSalary(actor, id, input) {
  const data = parse(salarySchema, input);
  const before = await getEmployee(actor, id);
  await run(
    'UPDATE employees SET basic_salary = ?, hra_pct = ?, medical_pct = ?, other_allowance = ?, updated_at = ? WHERE id = ?',
    data.basic_salary,
    data.hra_pct,
    data.medical_pct,
    data.other_allowance,
    nowIso(),
    id,
  );
  const after = await getEmployee(actor, id);
  await audit(actor, 'employee.salary_update', 'employee', id, before.salary, after.salary);
  return after;
}

// Employees may only edit their own phone and address.
const selfSchema = z.object({ phone: optionalText(30), address: optionalText(300) }).strict();

export async function updateOwnContact(actor, input) {
  const data = parse(selfSchema, input);
  const before = await getEmployee(actor, actor.employee_id);
  await run(
    'UPDATE employees SET phone = ?, address = ?, updated_at = ? WHERE id = ?',
    data.phone === undefined ? before.phone : data.phone,
    data.address === undefined ? before.address : data.address,
    nowIso(),
    actor.employee_id,
  );
  const after = await getEmployee(actor, actor.employee_id);
  await audit(actor, 'employee.self_update', 'employee', actor.employee_id, { phone: before.phone, address: before.address }, { phone: after.phone, address: after.address });
  return after;
}

// ---- CSV import / export ----

export const CSV_COLUMNS = ['code', 'first_name', 'last_name', 'email', 'phone', 'gender', 'department', 'designation', 'join_date', 'basic_salary', 'status'];
const REQUIRED = ['code', 'first_name', 'last_name', 'email', 'department', 'join_date', 'basic_salary'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dry run (default) validates every row and returns row + field + reason for each problem.
 * The real import is all-or-nothing and only runs when the file has no errors.
 */
export async function importEmployees(actor, input) {
  const { csv, dryRun } = parse(z.object({ csv: z.string().min(1, 'CSV file is empty').max(2_000_000), dryRun: z.boolean().default(true) }), input);
  let rows;
  try {
    rows = readCsv(csv);
  } catch (e) {
    throw unprocessable('CSV_PARSE', `Could not read the CSV: ${e.message}`);
  }
  if (!rows.length) throw unprocessable('CSV_EMPTY', 'The CSV has no data rows');
  if (rows.length > 500) throw unprocessable('CSV_TOO_LARGE', 'Import at most 500 rows at a time');
  const missingHeaders = REQUIRED.filter((h) => !(h in rows[0]));
  if (missingHeaders.length) {
    throw unprocessable('CSV_HEADERS', `Missing columns: ${missingHeaders.join(', ')}`, missingHeaders.map((h) => ({ row: 1, field: h, reason: 'Missing column' })));
  }

  const depts = new Map((await all('SELECT id, name FROM departments')).map((d) => [d.name.toLowerCase(), d.id]));
  const desigs = await all('SELECT id, name, department_id FROM designations');
  const existingCodes = new Set((await all('SELECT lower(code) AS c FROM employees')).map((r) => r.c));
  const existingEmails = new Set([
    ...(await all('SELECT lower(email) AS e FROM employees')).map((r) => r.e),
    ...(await all('SELECT lower(email) AS e FROM users')).map((r) => r.e),
  ]);
  const seenCodes = new Set();
  const seenEmails = new Set();
  const errors = [];
  const valid = [];

  rows.forEach((r, i) => {
    const row = i + 2; // line 1 is the header
    const err = (field, reason) => errors.push({ row, field, reason });
    const before = errors.length;
    for (const f of REQUIRED) if (!r[f]) err(f, 'Required');
    const code = r.code;
    const email = (r.email || '').toLowerCase();
    if (code) {
      const key = code.toLowerCase();
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) err('code', 'Use up to 20 letters, numbers, - or _');
      else if (seenCodes.has(key)) err('code', 'Duplicate code in this file');
      else if (existingCodes.has(key)) err('code', 'Code already exists');
      seenCodes.add(key);
    }
    if (email) {
      if (!EMAIL_RE.test(email)) err('email', 'Invalid email');
      else if (seenEmails.has(email)) err('email', 'Duplicate email in this file');
      else if (existingEmails.has(email)) err('email', 'Email already exists');
      seenEmails.add(email);
    }
    const deptId = r.department ? depts.get(r.department.toLowerCase()) : null;
    if (r.department && !deptId) err('department', `Unknown department "${r.department}"`);
    let desigId = null;
    if (r.designation) {
      const match = desigs.find((g) => g.name.toLowerCase() === r.designation.toLowerCase() && (!g.department_id || g.department_id === deptId));
      if (!match) err('designation', `Unknown designation "${r.designation}"`);
      else desigId = match.id;
    }
    if (r.join_date && !isISODate(r.join_date)) err('join_date', 'Use ISO date YYYY-MM-DD');
    const salary = Number(String(r.basic_salary || '').replace(/,/g, ''));
    if (r.basic_salary && !(salary > 0)) err('basic_salary', 'Salary must be a number greater than 0');
    const gender = r.gender ? r.gender.toLowerCase() : null;
    if (gender && !['male', 'female', 'other'].includes(gender)) err('gender', 'Use male, female or other');
    const status = r.status ? r.status.toLowerCase() : 'active';
    if (!['active', 'probation'].includes(status)) err('status', 'Use active or probation');
    if (errors.length === before) {
      valid.push({
        row,
        code,
        first_name: r.first_name,
        last_name: r.last_name,
        email,
        phone: r.phone || null,
        gender,
        department_id: deptId,
        designation_id: desigId,
        join_date: r.join_date,
        basic_salary: salary,
        status,
        department: r.department,
        designation: r.designation || null,
      });
    }
  });

  const summary = { total: rows.length, valid: valid.length, invalid: new Set(errors.map((e) => e.row)).size, errors };
  if (dryRun || errors.length) return { ...summary, dryRun: true, imported: 0, preview: valid.slice(0, 20) };

  const prepared = [];
  for (const v of valid) {
    const temp = tempPassword();
    prepared.push({ v, temp, hash: await hashPassword(temp) });
  }
  const credentials = await tx(async () => {
    const out = [];
    for (const { v, temp, hash } of prepared) {
      const employeeId = await insertEmployee(v, hash);
      out.push({ employee_id: employeeId, code: v.code, name: `${v.first_name} ${v.last_name}`, email: v.email, tempPassword: temp });
    }
    return out;
  });
  await audit(actor, 'employee.import', 'employee', null, null, { count: credentials.length, codes: credentials.map((c) => c.code) });
  return { ...summary, dryRun: false, imported: credentials.length, credentials };
}

export async function exportEmployeesCsv(filters) {
  // listEmployees caps the page size, so walk every page.
  const first = await listEmployees({ ...filters, page: 1, pageSize: 100 });
  let rows = first.rows;
  for (let p = 2; p <= first.pages; p++) rows = rows.concat((await listEmployees({ ...filters, page: p, pageSize: 100 })).rows);
  return toCsv(
    [...CSV_COLUMNS, 'exit_date', 'monthly_gross'],
    rows.map((e) => ({ ...e, monthly_gross: e.salary.gross })),
  );
}

export function csvTemplate() {
  return toCsv(CSV_COLUMNS, [
    { code: 'EMP-001', first_name: 'Ayesha', last_name: 'Khan', email: 'ayesha@example.com', phone: '0300-1234567', gender: 'female', department: 'Engineering', designation: '', join_date: '2026-10-01', basic_salary: '80000', status: 'active' },
  ]);
}
