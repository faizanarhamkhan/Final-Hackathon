import { all } from '../../db/index.js';
import { zonedNow, prettyDate, monthLabel } from '../../lib/dates.js';
import { getSettings, workCalendar } from '../settings.js';
import { runTool } from './tools.js';
import { looksLikeLeaveRequest, parseLeaveText } from './dateText.js';
import { policyText } from './policy.js';

/**
 * Offline assistant: used when no AI key is configured or the provider fails.
 * It routes common questions (English and Roman Urdu) to the same tools the model uses,
 * so answers keep the same numbers and the same permissions.
 */

const has = (t, re) => re.test(t);

function periodFrom(t) {
  if (has(t, /\btoday\b|\baaj\b/)) return 'today';
  if (has(t, /\byesterday\b/)) return 'yesterday';
  if (has(t, /last week|pichle hafte/)) return 'last_week';
  if (has(t, /this week|is hafte/)) return 'this_week';
  if (has(t, /last month|pichle mahine/)) return 'last_month';
  if (has(t, /this year|is saal/)) return 'this_year';
  return 'this_month';
}

async function deptFrom(t) {
  const depts = await all('SELECT name FROM departments ORDER BY length(name) DESC');
  return depts.find((d) => t.includes(d.name.toLowerCase()))?.name;
}

function leaveTypeFrom(t) {
  if (has(t, /sick|bemar|bimar/)) return 'sick';
  if (has(t, /casual/)) return 'casual';
  if (has(t, /annual/)) return 'annual';
  if (has(t, /unpaid/)) return 'unpaid';
  return undefined;
}

const pct = (v) => (v == null ? 'n/a' : `${v}%`);

export async function smartLeaveLocal(actor, text) {
  const s = await getSettings();
  const today = zonedNow(s.timezone).date;
  const codes = (await all('SELECT code FROM leave_types WHERE is_active ORDER BY id')).map((r) => r.code);
  const cal = await workCalendar(today, `${Number(today.slice(0, 4)) + 1}-12-31`);
  return parseLeaveText(text, today, codes, cal.isWorking);
}

export async function localAnswer(actor, message) {
  const t = message.toLowerCase();
  const used = [];
  const call = async (name, args = {}) => {
    used.push(name);
    return runTool(actor, name, args);
  };
  const s = await getSettings();
  const cur = s.currency;

  // Leave request in plain words -> prepare the form (never submit).
  if (looksLikeLeaveRequest(t) && !has(t, /\b(left|remaining|balance|baqi|baki|how many|kitni|kitne)\b/)) {
    const parsed = await smartLeaveLocal(actor, message);
    if (parsed) {
      const res = await call('draft_leave_request', parsed);
      if (res.ok) {
        const d = res.draft;
        return {
          reply: `I prepared a ${d.type_name} request for ${prettyDate(d.start_date)}${d.end_date !== d.start_date ? ` to ${prettyDate(d.end_date)}` : ''}${d.days != null ? ` (${d.days} working day${d.days === 1 ? '' : 's'})` : ''}. Please review and confirm the form to submit it.${res.warnings.length ? ` Note: ${res.warnings.join(' ')}` : ''}`,
          action: { type: 'leave_draft', draft: d, warnings: res.warnings },
          tools: used,
        };
      }
      return { reply: res.error, tools: used };
    }
  }

  if (has(t, /on leave|chutti (par|pe)|leave (par|pe)|who.*(leave|off) today|kaun.*chutti/)) {
    const r = await call('get_leave_summary', { department: await deptFrom(t) });
    if (r.error) return { reply: r.error, tools: used };
    if (r.scope) return { reply: r.on_leave_on_date ? 'Yes, you are on approved leave today.' : 'You are not on leave today. I can only share your own leave details.', tools: used };
    if (!r.on_leave_count) return { reply: `Nobody is on approved leave on ${prettyDate(r.date)}.`, tools: used };
    const types = Object.entries(r.on_leave_by_type).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ');
    return { reply: `${r.on_leave_count} employee${r.on_leave_count === 1 ? ' is' : 's are'} on leave on ${prettyDate(r.date)} (${types}): ${r.on_leave.map((l) => `${l.name} (${l.type})`).join(', ')}.`, tools: used };
  }

  if (has(t, /(leaves?|chutti|chuttiyan).*(left|remaining|balance|baqi|baki)|(how many|kitni|kitne).*(leave|chutti)|leave balance/)) {
    const r = await call('get_my_leave_balance', { type: leaveTypeFrom(t) });
    if (r.error) return { reply: r.error, tools: used };
    const lines = r.balances.map((b) => `${b.type}: ${b.remaining} left of ${b.quota} (${b.used_approved} used${b.pending ? `, ${b.pending} pending` : ''})`);
    return { reply: `Your ${r.year} leave balance - ${lines.join('; ')}.`, tools: used };
  }

  if (has(t, /how many.*(employee|staff|people)|headcount|kitne (log|employee|mulazim)/)) {
    const r = await call('get_headcount', { department: await deptFrom(t) });
    if (r.error) return { reply: r.error, tools: used };
    return { reply: `There ${r.active_employees === 1 ? 'is' : 'are'} ${r.active_employees} active employee${r.active_employees === 1 ? '' : 's'} in ${r.department} (as of ${prettyDate(r.as_of)}).`, tools: used };
  }

  if (has(t, /late|der se|late.?comer/)) {
    if (actor.role === 'employee') {
      const r = await call('get_attendance_summary', { period: periodFrom(t) });
      return { reply: `You were late ${r.late_arrivals} time(s) between ${r.from} and ${r.to}.`, tools: used };
    }
    const r = await call('get_late_comers', { period: periodFrom(t), department: await deptFrom(t) });
    if (r.error) return { reply: r.error, tools: used };
    if (!r.late_comers.length) return { reply: `No late check-ins between ${r.from} and ${r.to}.`, tools: used };
    const top = r.late_comers[0];
    return {
      reply: `${top.name} came late most often (${top.late_count} time${top.late_count === 1 ? '' : 's'}) between ${r.from} and ${r.to}. Top late-comers: ${r.late_comers.map((l) => `${l.name} ${l.late_count}`).join(', ')}.`,
      tools: used,
    };
  }

  if (has(t, /attendance|haziri|present|absent/)) {
    const r = await call('get_attendance_summary', { period: periodFrom(t), department: actor.role === 'employee' ? undefined : await deptFrom(t) });
    if (r.error) return { reply: r.error, tools: used };
    const c = r.counts;
    return {
      reply: `Attendance rate for ${r.scope}${r.department ? ` in ${r.department}` : ''} from ${r.from} to ${r.to}: ${pct(r.attendance_rate_pct)} (present ${c.present}, late ${c.late}, half day ${c.half_day}, missing checkout ${c.missing_checkout}, absent ${c.absent}, on leave ${c.on_leave}).`,
      tools: used,
    };
  }

  if (has(t, /payroll|salary|payslip|net pay|tankhwa|tankhah|pay\b/)) {
    const r = await call('get_payroll_summary', {});
    if (r.error) return { reply: r.error, tools: used };
    if (r.scope) {
      if (!r.payslips.length) return { reply: 'You have no finalized payslips yet.', tools: used };
      const p = r.payslips[0];
      return { reply: `Your latest payslip (${p.month}): gross ${cur} ${p.gross}, deductions ${cur} ${p.deductions}, tax ${cur} ${p.tax}, net ${cur} ${p.net}.`, tools: used };
    }
    if (r.message) return { reply: r.message, tools: used };
    return { reply: `${r.month} payroll (${r.status}): ${r.employees} employees, gross ${cur} ${r.total_gross}, tax ${cur} ${r.total_tax}, net ${cur} ${r.total_net}.`, tools: used };
  }

  if (actor.role !== 'employee' && has(t, /\b(find|search|who is|list|show)\b/)) {
    const q = message.replace(/.*\b(find|search|who is|list|show)\b/i, '').replace(/[?.!]/g, '').trim();
    const r = await call('search_employees', { query: q || undefined, department: await deptFrom(t) });
    if (r.error) return { reply: r.error, tools: used };
    if (!r.total) return { reply: 'No matching employees found.', tools: used };
    return { reply: `Found ${r.total}: ${r.employees.map((e) => `${e.name} (${e.code}, ${e.department || 'no dept'}${e.designation ? `, ${e.designation}` : ''})`).join('; ')}.`, tools: used };
  }

  if (has(t, /grace|half.?day|weekend|quota|tax|deduct|per.?day|holiday|policy|rule|office hours|check.?in time|camera|finaliz/)) {
    const policy = await policyText();
    const sections = policy.split('\n');
    const pick = has(t, /tax|deduct|per.?day|payroll|finaliz/)
      ? sections.find((x) => x.startsWith('PAYROLL'))
      : has(t, /quota|leave/)
        ? sections.find((x) => x.startsWith('LEAVE'))
        : has(t, /holiday/)
          ? sections.find((x) => x.startsWith('HOLIDAYS'))
          : sections.find((x) => x.startsWith('ATTENDANCE'));
    return { reply: pick.replace(/^[A-Z]+: /, ''), tools: used };
  }

  return {
    reply:
      actor.role === 'employee'
        ? `I can help with your attendance, leave balance, payslips and company policy, or prepare a leave request (e.g. "I need next Monday off for a wedding"). Month: ${monthLabel(zonedNow(s.timezone).month)}.`
        : 'Try: "Who is on leave today?", "How many active employees are in Engineering?", "Who came late most often this month?", "What is this month\'s attendance rate?" or "Payroll summary".',
    tools: used,
  };
}
