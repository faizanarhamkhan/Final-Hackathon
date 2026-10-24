import * as setup from '../services/setup.js';
import * as auth from '../services/auth.js';
import * as settings from '../services/settings.js';
import * as users from '../services/users.js';
import * as org from '../services/org.js';
import * as employees from '../services/employees.js';
import * as attendance from '../services/attendance.js';
import * as leave from '../services/leave.js';
import * as payroll from '../services/payroll.js';
import * as analytics from '../services/analytics.js';
import * as comms from '../services/comms.js';
import * as auditSvc from '../services/audit.js';
import * as ai from '../services/ai/index.js';
import { renderPayslipPdf } from '../services/payslipPdf.js';
import { forbidden } from '../lib/http.js';

/**
 * Route table. `roles`: 'public' (no login), 'any' (any signed-in user) or a list of roles.
 * Role checks happen here on the server for every request; data scope (an Employee only
 * reaching their own employee_id) is enforced again inside the services.
 */
const ADMIN = ['admin'];
const HR = ['hr'];
const STAFF = ['admin', 'hr'];
const SELF = ['hr', 'employee']; // people who can have their own employee profile

const id = (p) => Number(p.id);
const file = (body, type, name) => ({ __file: { body, type, name } });

export const routes = [
  // M1 Auth & first-run setup
  ['GET', 'health', 'public', () => ({ ok: true })],
  ['GET', 'setup/status', 'public', () => setup.setupStatus()],
  ['POST', 'setup', 'public', ({ body }) => setup.runSetup(body)],
  ['POST', 'auth/login', 'public', ({ body, ip }) => auth.login(body, ip)],
  ['GET', 'auth/me', 'any', ({ actor }) => auth.profile(actor.id)],
  ['POST', 'auth/change-password', 'any', ({ actor, body }) => auth.changePassword(actor, body)],
  ['POST', 'auth/logout', 'any', () => ({ ok: true })],

  // M2 Organization setup
  ['GET', 'settings', STAFF, () => settings.getSettings()],
  ['PUT', 'settings', ADMIN, ({ actor, body }) => settings.updateSettings(actor, body)],
  ['GET', 'users', ADMIN, ({ query }) => users.listUsers(query)],
  ['POST', 'users/hr', ADMIN, ({ actor, body }) => users.createHrUser(actor, body)],
  ['PATCH', 'users/:id/status', ADMIN, ({ actor, params, body }) => users.setActive(actor, id(params), body)],
  ['POST', 'users/:id/reset-password', ADMIN, ({ actor, params }) => users.resetPassword(actor, id(params))],
  ['PATCH', 'users/:id/role', ADMIN, ({ actor, params, body }) => users.setRole(actor, id(params), body)],
  ['GET', 'org/departments', 'any', () => org.listDepartments()],
  ['POST', 'org/departments', ADMIN, ({ actor, body }) => org.createDepartment(actor, body)],
  ['PUT', 'org/departments/:id', ADMIN, ({ actor, params, body }) => org.updateDepartment(actor, id(params), body)],
  ['DELETE', 'org/departments/:id', ADMIN, ({ actor, params }) => org.deleteDepartment(actor, id(params))],
  ['GET', 'org/designations', STAFF, () => org.listDesignations()],
  ['POST', 'org/designations', ADMIN, ({ actor, body }) => org.createDesignation(actor, body)],
  ['PUT', 'org/designations/:id', ADMIN, ({ actor, params, body }) => org.updateDesignation(actor, id(params), body)],
  ['DELETE', 'org/designations/:id', ADMIN, ({ actor, params }) => org.deleteDesignation(actor, id(params))],
  ['GET', 'org/leave-types', 'any', ({ actor }) => org.listLeaveTypes({ activeOnly: actor.role === 'employee' })],
  ['POST', 'org/leave-types', ADMIN, ({ actor, body }) => org.createLeaveType(actor, body)],
  ['PUT', 'org/leave-types/:id', ADMIN, ({ actor, params, body }) => org.updateLeaveType(actor, id(params), body)],
  ['DELETE', 'org/leave-types/:id', ADMIN, ({ actor, params }) => org.deleteLeaveType(actor, id(params))],
  ['GET', 'org/holidays', 'any', ({ query }) => org.listHolidays(query)],
  ['POST', 'org/holidays', ADMIN, ({ actor, body }) => org.createHoliday(actor, body)],
  ['PUT', 'org/holidays/:id', ADMIN, ({ actor, params, body }) => org.updateHoliday(actor, id(params), body)],
  ['DELETE', 'org/holidays/:id', ADMIN, ({ actor, params }) => org.deleteHoliday(actor, id(params))],

  // M3 Employees
  ['GET', 'employees', STAFF, ({ query }) => employees.listEmployees(query)],
  ['POST', 'employees', HR, ({ actor, body }) => employees.createEmployee(actor, body)],
  ['GET', 'employees/export.csv', HR, async ({ query }) => file(await employees.exportEmployeesCsv(query), 'text/csv; charset=utf-8', 'employees.csv')],
  ['GET', 'employees/template.csv', HR, () => file(employees.csvTemplate(), 'text/csv; charset=utf-8', 'employees-template.csv')],
  ['POST', 'employees/import', HR, ({ actor, body }) => employees.importEmployees(actor, body)],
  ['GET', 'employees/:id', 'any', ({ actor, params }) => employees.getEmployee(actor, id(params))],
  ['PUT', 'employees/:id', HR, ({ actor, params, body }) => employees.updateEmployee(actor, id(params), body)],
  ['PUT', 'employees/:id/salary', HR, ({ actor, params, body }) => employees.updateSalary(actor, id(params), body)],
  ['GET', 'me/profile', SELF, ({ actor }) => employees.getEmployee(actor, actor.employee_id ?? 0)],
  ['PATCH', 'me/profile', SELF, ({ actor, body }) => employees.updateOwnContact(actor, body)],

  // M4 Attendance
  ['GET', 'attendance/today', SELF, ({ actor }) => attendance.getToday(actor)],
  ['POST', 'attendance/check-in', SELF, ({ actor, body }) => attendance.checkIn(actor, body)],
  ['POST', 'attendance/check-out', SELF, ({ actor, body }) => attendance.checkOut(actor, body)],
  ['GET', 'attendance/calendar', 'any', ({ actor, query }) => attendance.calendarMonth(actor, query)],
  ['GET', 'attendance/board', STAFF, ({ actor, query }) => attendance.board(actor, query)],
  ['GET', 'attendance/records', 'any', ({ actor, query }) => attendance.listRecords(actor, query)],
  ['GET', 'attendance/corrections', 'any', ({ actor, query }) => attendance.listCorrections(actor, query)],
  ['POST', 'attendance/corrections', SELF, ({ actor, body }) => attendance.requestCorrection(actor, body)],
  ['POST', 'attendance/corrections/:id/review', HR, ({ actor, params, body }) => attendance.reviewCorrection(actor, id(params), body)],

  // M5 Leave
  ['GET', 'leave/balance', 'any', ({ actor, query }) => leave.myBalances(actor, query)],
  ['GET', 'leave/requests', 'any', ({ actor, query }) => leave.listRequests(actor, query)],
  ['POST', 'leave/requests', SELF, ({ actor, body }) => leave.applyLeave(actor, body)],
  ['POST', 'leave/requests/:id/cancel', SELF, ({ actor, params }) => leave.cancelLeave(actor, id(params))],
  ['POST', 'leave/requests/:id/review', HR, ({ actor, params, body }) => leave.reviewLeave(actor, id(params), body)],

  // M6 Payroll
  ['GET', 'payroll/runs', STAFF, () => payroll.listRuns()],
  ['POST', 'payroll/runs', HR, ({ actor, body }) => payroll.createOrRecalculate(actor, body)],
  ['GET', 'payroll/runs/:id', STAFF, ({ actor, params }) => payroll.getRunDetail(actor, id(params))],
  ['POST', 'payroll/runs/:id/finalize', ADMIN, ({ actor, params }) => payroll.finalizeRun(actor, id(params))],
  ['DELETE', 'payroll/runs/:id', HR, ({ actor, params }) => payroll.deleteDraft(actor, id(params))],
  ['GET', 'payroll/payslips', 'any', ({ actor, query }) => payroll.listPayslips(actor, query)],
  ['GET', 'payroll/payslips/:id', 'any', ({ actor, params }) => payroll.getPayslip(actor, id(params))],
  [
    'GET',
    'payroll/payslips/:id/pdf',
    'any',
    async ({ actor, params }) => {
      const p = await payroll.getPayslip(actor, id(params));
      return file(await renderPayslipPdf(p, await settings.getSettings()), 'application/pdf', `payslip-${p.code}-${p.month}.pdf`);
    },
  ],

  // M7 Dashboards & analytics
  ['GET', 'dashboard/admin', ADMIN, ({ query }) => analytics.adminDashboard(query)],
  ['GET', 'dashboard/hr', STAFF, ({ query }) => analytics.hrDashboard(query)],
  ['GET', 'dashboard/employee', SELF, ({ actor }) => analytics.employeeDashboard(actor)],

  // M8 AI assistant
  ['GET', 'ai/status', 'any', () => ai.aiStatus()],
  ['POST', 'ai/chat', 'any', ({ actor, body }) => ai.chat(actor, body)],
  ['POST', 'ai/summary', STAFF, ({ actor, body }) => ai.dashboardSummary(actor, body)],
  ['POST', 'ai/smart-leave', SELF, ({ actor, body }) => ai.smartLeave(actor, body)],
  ['GET', 'ai/logs', ADMIN, ({ query }) => ai.listAiLogs(query)],

  // M9 Comms & audit
  ['GET', 'announcements', 'any', ({ query }) => comms.listAnnouncements(query)],
  ['POST', 'announcements', STAFF, ({ actor, body }) => comms.createAnnouncement(actor, body)],
  ['DELETE', 'announcements/:id', STAFF, ({ actor, params }) => comms.deleteAnnouncement(actor, id(params))],
  ['GET', 'notifications', 'any', ({ actor, query }) => comms.listNotifications(actor, query)],
  ['POST', 'notifications/read-all', 'any', ({ actor }) => comms.markAllRead(actor)],
  ['POST', 'notifications/:id/read', 'any', ({ actor, params }) => comms.markRead(actor, id(params))],
  ['GET', 'audit', ADMIN, ({ query }) => auditSvc.listAudit(query)],
  // There are deliberately no routes that update or delete audit entries.
  ['PUT', 'audit/:id', 'any', () => {
    throw forbidden('Audit log entries cannot be changed');
  }],
  ['DELETE', 'audit/:id', 'any', () => {
    throw forbidden('Audit log entries cannot be deleted');
  }],
];
