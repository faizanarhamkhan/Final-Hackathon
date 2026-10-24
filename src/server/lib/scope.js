import { forbidden, unprocessable } from './http.js';

// The employee profile behind the signed-in login (HR users may also have one).
export function ownEmployeeId(actor) {
  if (!actor.employee_id) {
    throw unprocessable('NO_EMPLOYEE_PROFILE', 'Your login is not linked to an employee profile, so there are no personal records.');
  }
  return actor.employee_id;
}

// Employees are always pinned to their own employee_id; Admin and HR may ask for anyone.
export function scopedEmployeeId(actor, requested) {
  const req = requested == null || requested === '' ? null : Number(requested);
  if (actor.role === 'employee') {
    if (req && req !== actor.employee_id) throw forbidden('You can only see your own records');
    return ownEmployeeId(actor);
  }
  return req;
}

export function assertCanSeeEmployee(actor, employeeId) {
  if (actor.role === 'employee' && Number(employeeId) !== actor.employee_id) {
    throw forbidden('You can only see your own records');
  }
}
