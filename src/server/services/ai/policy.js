import { all } from '../../db/index.js';
import { WEEKDAYS, addDays, prettyDate, zonedNow, dayOfWeek } from '../../lib/dates.js';
import { TAX_SLABS } from '../../lib/money.js';
import { getSettings } from '../settings.js';

const fmt = (n) => Number(n).toLocaleString('en-US');

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// Company policy built from the live settings, so the assistant always quotes current rules.
export async function policyText() {
  const s = await getSettings();
  const types = await all('SELECT name, code, yearly_quota, is_paid FROM leave_types WHERE is_active ORDER BY id');
  const today = zonedNow(s.timezone).date;
  const holidays = await all('SELECT date, name FROM holidays WHERE date >= ? ORDER BY date LIMIT 8', today);
  const weekend = s.weekend_days.map((d) => WEEKDAYS[d]).join(' and ') || 'none';
  const slabs = TAX_SLABS.map((t, i) => {
    const lo = i === 0 ? 0 : TAX_SLABS[i - 1].upTo;
    const range = t.upTo === Infinity ? `above ${fmt(lo)}` : `${fmt(lo)} to ${fmt(t.upTo)}`;
    return `${range}: ${t.rate === 0 ? 'no tax' : `${t.base ? `${fmt(t.base)} + ` : ''}${t.rate * 100}% of the amount over ${fmt(t.over)}`}`;
  }).join('; ');
  return [
    `ATTENDANCE: Office hours ${s.office_start}-${s.office_end}. Grace period ${s.grace_minutes} minutes, so a check-in after ${addMinutes(s.office_start, s.grace_minutes)} is late. Working fewer than ${s.half_day_hours} hours is a half day. Weekend: ${weekend}. A working day with no attendance record and no approved leave is absent. Checking in without checking out is "missing checkout". The server stamps the check-in time; only one check-in per day. Camera check-in needs exactly one face, GPS accuracy of 100 m or better and being within ${s.office_radius_m} m of the office. Wrong attendance is fixed by a correction request with a reason, approved by HR.`,
    `LEAVE: Counted in working days only (weekends and public holidays are skipped). Yearly quotas: ${types.map((t) => `${t.name} ${t.yearly_quota == null ? 'unlimited' : `${t.yearly_quota} days`}${t.is_paid ? '' : ' (unpaid)'}`).join(', ')}. A request that overlaps another request or exceeds the balance is rejected. HR approves or rejects with a comment. Employees can cancel pending leave, or approved leave that has not started.`,
    `PAYROLL: Gross = basic + house rent 40% of basic + medical 10% of basic = 1.5 x basic. Per-day rate = gross / working days in the month. Deductions = per-day rate x (absent days + unpaid leave days + 0.5 x half days)${s.late_penalty_enabled ? ' + 0.5 day for every 3 late arrivals' : ''}. Joiners and leavers are paid for the working days they were employed. Income tax (illustrative) on annual gross (monthly gross x 12): ${slabs}; monthly tax = annual tax / 12. HR prepares the monthly draft, only Admin can finalize it, and finalized payroll is locked. Payslips appear for employees once payroll is finalized.`,
    `HOLIDAYS: ${holidays.length ? holidays.map((h) => `${h.date} ${h.name}`).join('; ') : 'none announced'}.`,
  ].join('\n');
}

// A short calendar so the model resolves "next Monday" etc. correctly.
export function calendarHint(today, days = 21) {
  const lines = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(today, i);
    lines.push(`${d} ${WEEKDAYS[dayOfWeek(d)]}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`);
  }
  return lines.join('\n');
}

export async function chatSystemPrompt(actor) {
  const s = await getSettings();
  const today = zonedNow(s.timezone).date;
  const scope =
    actor.role === 'admin'
      ? 'This user is an Admin and may see all company data.'
      : actor.role === 'hr'
        ? 'This user is HR and may see employee, attendance, leave and payroll data for everyone.'
        : `This user is an Employee and may ONLY see their own records plus company policy. If they ask about any other person's salary, attendance, leave or personal details, politely refuse and do not call a tool for it.`;
  return `You are the HCM Lite HR assistant for ${s.company_name || 'the company'}.
Today is ${prettyDate(today)} (${today}), time zone ${s.timezone}. Currency: ${s.currency}.
You are talking to ${actor.name} (role: ${actor.role}). ${scope}

Rules:
- Use the tools for any number or record. Never invent numbers, names or dates; if a tool returns nothing, say so.
- Answer company-rule questions only from the POLICY below; if the policy does not cover it, say you do not know.
- Keep answers short: one to four sentences or a short list. Use the same numbers the tools return.
- "Next Monday" means the first Monday after today. Use the calendar below for dates.
- For time off requests call draft_leave_request. It only prepares a form; never say the leave was submitted or approved.
- If the user writes in Roman Urdu, reply in Roman Urdu.

POLICY:
${await policyText()}

CALENDAR:
${calendarHint(today, 14)}`;
}
