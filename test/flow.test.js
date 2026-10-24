import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { api, signIn, setNow, closeDb } from './helpers.js';

after(() => closeDb());

// Shared state across the ordered steps of the demo script.
const s = {};
const at = (iso) => setNow(iso); // Asia/Karachi is UTC+5

test('first-run setup creates the company and the Admin', async () => {
  at('2026-10-19T03:00:00Z'); // Mon 19 Oct, 08:00 local
  assert.equal((await api('GET', 'setup/status')).data.setupDone, false);
  const r = await api('POST', 'setup', {
    body: { company_name: 'Saylani Tech', timezone: 'Asia/Karachi', admin_name: 'Admin One', admin_email: 'admin@test.pk', admin_password: 'Admin1234' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await api('POST', 'setup', { body: { company_name: 'Other Co', admin_name: 'Yasir', admin_email: 'y@y.pk', admin_password: 'Admin1234' } })).status, 409);
  s.admin = await signIn('admin@test.pk', 'Admin1234');
  assert.equal((await api('GET', 'org/leave-types', { token: s.admin })).data.length, 4);
});

test('Admin sets up org and creates an HR login with a forced password change', async () => {
  const set = await api('PUT', 'settings', { token: s.admin, body: { office_lat: 24.8607, office_lng: 67.0011, office_radius_m: 150 } });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  s.eng = (await api('POST', 'org/departments', { token: s.admin, body: { name: 'Engineering' } })).data;
  s.ops = (await api('POST', 'org/departments', { token: s.admin, body: { name: 'Operations' } })).data;
  assert.equal((await api('POST', 'org/departments', { token: s.admin, body: { name: 'engineering' } })).status, 409);
  const hr = await api('POST', 'users/hr', { token: s.admin, body: { name: 'Hira HR', email: 'hr@test.pk' } });
  assert.equal(hr.status, 200);
  const first = await api('POST', 'auth/login', { body: { email: 'hr@test.pk', password: hr.data.credentials.tempPassword } });
  assert.equal(first.data.user.must_change_password, true);
  assert.equal((await api('GET', 'employees', { token: first.data.token })).data.error.code, 'PASSWORD_CHANGE_REQUIRED');
  s.hr = await signIn('hr@test.pk', hr.data.credentials.tempPassword, 'HrPass123');
  // HR cannot change company settings or see the audit log
  assert.equal((await api('PUT', 'settings', { token: s.hr, body: { grace_minutes: 30 } })).status, 403);
  assert.equal((await api('GET', 'audit', { token: s.hr })).status, 403);
});

test('HR registers employees; each gets a login', async () => {
  const mk = (code, first, email, dept, basic) =>
    api('POST', 'employees', {
      token: s.hr,
      body: { code, first_name: first, last_name: 'Test', email, department_id: dept, join_date: '2026-10-01', basic_salary: basic, gender: 'female' },
    });
  const a = await mk('E-001', 'Ayesha', 'ayesha@test.pk', s.eng.id, 100000);
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.employee.salary.gross, 150000);
  const b = await mk('E-002', 'Bilal', 'bilal@test.pk', s.ops.id, 60000);
  assert.equal(b.status, 200);
  assert.equal((await mk('E-001', 'Dup', 'dup@test.pk', s.eng.id, 1)).status, 409);
  s.ayeshaId = a.data.employee.id;
  s.bilalId = b.data.employee.id;
  s.ayesha = await signIn('ayesha@test.pk', a.data.credentials.tempPassword);
  s.bilal = await signIn('bilal@test.pk', b.data.credentials.tempPassword);
});

test('Employees only see their own data (server-side scope)', async () => {
  assert.equal((await api('GET', 'employees', { token: s.ayesha })).status, 403);
  assert.equal((await api('GET', `employees/${s.bilalId}`, { token: s.ayesha })).status, 403);
  assert.equal((await api('GET', `employees/${s.ayeshaId}`, { token: s.ayesha })).status, 200);
  assert.equal((await api('GET', `leave/requests?employee_id=${s.bilalId}`, { token: s.ayesha })).status, 403);
  const upd = await api('PATCH', 'me/profile', { token: s.ayesha, body: { phone: '0300-1112223', basic_salary: 999999 } });
  assert.equal(upd.status, 422, 'employees cannot send salary fields');
  assert.equal((await api('PATCH', 'me/profile', { token: s.ayesha, body: { phone: '0300-1112223' } })).data.phone, '0300-1112223');
});

test('Check-in: server time, late rule, one per day, camera geofence', async () => {
  at('2026-10-20T04:30:00Z'); // Tue 09:30 local -> late
  const ci = await api('POST', 'attendance/check-in', { token: s.ayesha, body: {} });
  assert.equal(ci.status, 200, JSON.stringify(ci.data));
  assert.equal(ci.data.status, 'late');
  assert.equal(ci.data.check_in, '09:30:00');
  assert.equal((await api('POST', 'attendance/check-in', { token: s.ayesha, body: {} })).status, 409);

  const far = await api('POST', 'attendance/check-in', {
    token: s.bilal,
    body: { source: 'camera', face_count: 1, lat: 24.87, lng: 67.0011, accuracy: 20 },
  });
  assert.equal(far.data.error.code, 'OUTSIDE_OFFICE');
  const two = await api('POST', 'attendance/check-in', { token: s.bilal, body: { source: 'camera', face_count: 2, lat: 24.8607, lng: 67.0011, accuracy: 20 } });
  assert.equal(two.data.error.code, 'MULTIPLE_FACES');
  const ok = await api('POST', 'attendance/check-in', { token: s.bilal, body: { source: 'camera', face_count: 1, lat: 24.8608, lng: 67.0012, accuracy: 15 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.source, 'camera');

  at('2026-10-20T07:00:00Z'); // 12:00 -> Ayesha leaves after 2.5 h = half day
  const co = await api('POST', 'attendance/check-out', { token: s.ayesha, body: {} });
  assert.equal(co.data.status, 'half_day');
});

test('Leave: smart leave draft, overlap and balance rules, approval', async () => {
  at('2026-10-24T05:00:00Z'); // Sat 24 Oct 2026 (hackathon day)
  const draft = await api('POST', 'ai/smart-leave', { token: s.ayesha, body: { text: "I need next Monday and Tuesday off for my sister's wedding" } });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.equal(draft.data.draft.type, 'casual');
  assert.equal(draft.data.draft.start_date, '2026-10-26');
  assert.equal(draft.data.draft.end_date, '2026-10-27');
  assert.equal(draft.data.draft.days, 2);
  // Nothing is saved until the user confirms.
  assert.equal((await api('GET', 'leave/requests', { token: s.ayesha })).data.length, 0);

  const d = draft.data.draft;
  const apply = await api('POST', 'leave/requests', { token: s.ayesha, body: { leave_type_id: d.leave_type_id, start_date: d.start_date, end_date: d.end_date, reason: d.reason, source: 'ai' } });
  assert.equal(apply.status, 200, JSON.stringify(apply.data));
  s.leaveId = apply.data.id;
  const overlap = await api('POST', 'leave/requests', { token: s.ayesha, body: { type: 'sick', start_date: '2026-10-27', end_date: '2026-10-28', reason: 'flu' } });
  assert.equal(overlap.data.error.code, 'OVERLAP');
  const tooMany = await api('POST', 'leave/requests', { token: s.ayesha, body: { type: 'sick', start_date: '2026-11-02', end_date: '2026-11-13', reason: 'surgery' } });
  assert.equal(tooMany.status, 422);
  assert.equal(tooMany.data.error.code, 'INSUFFICIENT_BALANCE');
  const weekend = await api('POST', 'leave/requests', { token: s.ayesha, body: { type: 'casual', start_date: '2026-10-31', end_date: '2026-11-01', reason: 'weekend' } });
  assert.equal(weekend.data.error.code, 'NO_WORKING_DAYS');

  assert.equal((await api('POST', `leave/requests/${s.leaveId}/review`, { token: s.ayesha, body: { decision: 'approved' } })).status, 403);
  assert.equal((await api('POST', `leave/requests/${s.leaveId}/review`, { token: s.admin, body: { decision: 'approved' } })).status, 403);
  const ok = await api('POST', `leave/requests/${s.leaveId}/review`, { token: s.hr, body: { decision: 'approved', comment: 'Congratulations' } });
  assert.equal(ok.data.status, 'approved');
  const bal = await api('GET', 'leave/balance', { token: s.ayesha });
  assert.equal(bal.data.find((b) => b.code === 'casual').remaining, 8);
  const notes = await api('GET', 'notifications', { token: s.ayesha });
  assert.ok(notes.data.rows.some((n) => n.title === 'Leave approved'));
});

test('Assistant answers from the same data, with role scoping (offline mode)', async () => {
  at('2026-10-26T05:00:00Z'); // Mon 26 Oct
  const who = await api('POST', 'ai/chat', { token: s.hr, body: { message: 'Who is on leave today?' } });
  assert.match(who.data.reply, /1 employee is on leave/);
  assert.match(who.data.reply, /Ayesha Test/);
  const hc = await api('POST', 'ai/chat', { token: s.hr, body: { message: 'How many active employees are in Engineering?' } });
  assert.match(hc.data.reply, /1 active employee in Engineering/);
  const late = await api('POST', 'ai/chat', { token: s.hr, body: { message: 'Who came late most often this month?' } });
  assert.match(late.data.reply, /Ayesha Test came late most often \(1 time\)/);
  const sick = await api('POST', 'ai/chat', { token: s.ayesha, body: { message: 'How many sick leaves do I have left this year?' } });
  assert.match(sick.data.reply, /Sick leave: 8 left of 8/);
  const salary = await api('POST', 'ai/chat', { token: s.ayesha, body: { message: "What is Bilal's salary?" } });
  assert.equal(salary.data.refused, true);
  assert.match(salary.data.reply, /can't share/);
  // HR staff have no employee record but are still protected.
  const hrSalary = await api('POST', 'ai/chat', { token: s.ayesha, body: { message: "What is Hira's salary?" } });
  assert.equal(hrSalary.data.refused, true);
  const mine = await api('POST', 'ai/chat', { token: s.ayesha, body: { message: 'What is my salary?' } });
  assert.notEqual(mine.data.refused, true);
  // The employee's tools cannot reach other people's data either.
  const scoped = await api('POST', 'ai/chat', { token: s.bilal, body: { message: 'Who is on leave today?' } });
  assert.doesNotMatch(scoped.data.reply, /Ayesha/);
  const chatLeave = await api('POST', 'ai/chat', { token: s.bilal, body: { message: 'I need tomorrow off, I am sick' } });
  assert.equal(chatLeave.data.action.type, 'leave_draft');
  assert.equal(chatLeave.data.action.draft.type, 'sick');
  assert.equal(chatLeave.data.action.draft.start_date, '2026-10-27');

  // Dashboard numbers match the assistant.
  const dash = await api('GET', 'dashboard/hr', { token: s.hr });
  assert.equal(dash.data.kpis.today.on_leave, 1);
  assert.equal(dash.data.top_late[0].late_count, 1);
  const sum = await api('POST', 'ai/summary', { token: s.hr, body: {} });
  assert.ok(sum.data.bullets.length >= 3 && sum.data.bullets.length <= 5);
  assert.equal((await api('POST', 'ai/summary', { token: s.ayesha, body: {} })).status, 403);
});

test('Payroll: HR drafts, Admin finalizes, then it is locked; payslip PDF', async () => {
  at('2026-10-30T10:00:00Z');
  assert.equal((await api('POST', 'payroll/runs', { token: s.admin, body: { month: '2026-10' } })).status, 403);
  const draft = await api('POST', 'payroll/runs', { token: s.hr, body: { month: '2026-10' } });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.equal(draft.data.working_days, 22);
  const a = draft.data.payslips.find((p) => p.code === 'E-001');
  // Ayesha (joined 1 Oct, basic 100k): worked only on the 20th (half day), paid casual leave 26-27,
  // so 21 working days up to the 29th - 1 half day - 2 leave = 18 absent. Today (30th) is not counted yet.
  assert.equal(a.monthly_gross, 150000);
  assert.equal(a.half_days, 1);
  assert.equal(a.absent_days, 18);
  assert.equal(a.unpaid_leave_days, 0);
  assert.equal(a.per_day, 6818.18);
  assert.equal(a.deductions, Math.round((150000 / 22) * 18.5 * 100) / 100);
  // Annual gross 1.8M -> 30,000 + 15% of 600,000 = 120,000 per year = 10,000 per month
  assert.equal(a.tax, 10000);
  assert.equal(a.net, Math.round((150000 - a.deductions - 10000) * 100) / 100);
  assert.equal((await api('GET', 'payroll/payslips', { token: s.ayesha })).data.length, 0, 'drafts are hidden from employees');

  assert.equal((await api('POST', `payroll/runs/${draft.data.id}/finalize`, { token: s.hr })).status, 403);
  const fin = await api('POST', `payroll/runs/${draft.data.id}/finalize`, { token: s.admin });
  assert.equal(fin.data.status, 'finalized');
  const again = await api('POST', 'payroll/runs', { token: s.hr, body: { month: '2026-10' } });
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'PAYROLL_LOCKED');

  const mine = await api('GET', 'payroll/payslips', { token: s.ayesha });
  assert.equal(mine.data.length, 1);
  const pdf = await api('GET', `payroll/payslips/${mine.data[0].id}/pdf`, { token: s.ayesha });
  assert.equal(pdf.status, 200);
  assert.match(pdf.type, /application\/pdf/);
  const bilalSlip = (await api('GET', 'payroll/payslips', { token: s.bilal })).data[0];
  assert.equal((await api('GET', `payroll/payslips/${bilalSlip.id}/pdf`, { token: s.ayesha })).status, 403);
});

test('CSV import dry run reports row + field + reason', async () => {
  const csv = [
    'code,first_name,last_name,email,department,join_date,basic_salary',
    'E-010,Sara,Ali,sara@test.pk,Engineering,2026-10-05,70000',
    'E-001,Dup,Code,dup@test.pk,Engineering,2026-10-05,70000',
    'E-011,Bad,Row,not-an-email,Marketing,05/10/2026,-5',
  ].join('\n');
  const dry = await api('POST', 'employees/import', { token: s.hr, body: { csv, dryRun: true } });
  assert.equal(dry.status, 200);
  assert.equal(dry.data.valid, 1);
  const fields = dry.data.errors.map((e) => `${e.row}:${e.field}`);
  assert.deepEqual(fields.sort(), ['3:code', '4:basic_salary', '4:department', '4:email', '4:join_date'].sort());
  const blocked = await api('POST', 'employees/import', { token: s.hr, body: { csv, dryRun: false } });
  assert.equal(blocked.data.imported, 0);
  const good = await api('POST', 'employees/import', { token: s.hr, body: { csv: csv.split('\n').slice(0, 2).join('\n'), dryRun: false } });
  assert.equal(good.data.imported, 1);
  assert.ok(good.data.credentials[0].tempPassword);
});

test('Audit log records actions and cannot be changed', async () => {
  const log = await api('GET', 'audit?pageSize=100', { token: s.admin });
  const actions = new Set(log.data.rows.map((r) => r.action));
  for (const a of ['setup.complete', 'user.create_hr', 'employee.create', 'leave.approve', 'payroll.finalize', 'attendance.check_in']) assert.ok(actions.has(a), a);
  assert.equal((await api('DELETE', `audit/${log.data.rows[0].id}`, { token: s.admin })).status, 403);
});
