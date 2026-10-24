import { all, get, run } from '../../db/index.js';
import { config } from '../../config.js';
import { parse, z, isoDate } from '../../lib/validate.js';
import { forbidden, tooMany } from '../../lib/http.js';
import { zonedNow, isISODate } from '../../lib/dates.js';
import { getSettings } from '../settings.js';
import { adminDashboard, hrDashboard } from '../analytics.js';
import { aiConfigured, AiUnavailable, chatCompletion, deadline } from './llm.js';
import { chatSystemPrompt, calendarHint } from './policy.js';
import { draftLeave, runTool, toolSchemas } from './tools.js';
import { localAnswer, smartLeaveLocal } from './local.js';

const FRIENDLY_FALLBACK = 'The AI service is not responding right now, so the built-in assistant answered instead.';

export function aiStatus() {
  return { configured: aiConfigured(), model: aiConfigured() ? config.ai.model : null, provider: aiConfigured() ? new URL(config.ai.baseUrl).host : 'offline assistant' };
}

// About 20 AI requests per user per hour, counted from ai_logs.
async function enforceRateLimit(actor) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const n = (await get('SELECT COUNT(*) AS n FROM ai_logs WHERE user_id = ? AND created_at >= ?', actor.id, since)).n;
  if (n >= config.ai.ratePerHour) throw tooMany(`You have reached ${config.ai.ratePerHour} assistant requests this hour. Please try again later.`);
}

async function logAi(actor, feature, { prompt, tools, response, status, provider, started }) {
  await run(
    'INSERT INTO ai_logs (user_id, feature, prompt, tools, response, status, provider, latency_ms) VALUES (?, ?, ?, ?::jsonb, ?, ?, ?, ?)',
    actor.id,
    feature,
    String(prompt ?? '').slice(0, 2000),
    JSON.stringify(tools || []),
    String(response ?? '').slice(0, 4000),
    status,
    provider,
    Date.now() - started,
  );
}

// Deterministic guard: an Employee asking about someone else's pay is refused before any model call.
async function colleagueSalaryGuard(actor, text) {
  if (actor.role !== 'employee') return null;
  const t = text.toLowerCase();
  if (!/salary|salaries|pay\b|paid|payslip|income|earn|tankhwa|tankhah|ctc|package/.test(t)) return null;
  // Names of everyone else with a login or an employee record (HR and Admin included).
  const ownNames = new Set(actor.name.toLowerCase().split(/\s+/));
  const people = await all(
    `SELECT lower(first_name) AS a, lower(last_name) AS b FROM employees WHERE id != ?
     UNION SELECT lower(split_part(name, ' ', 1)), lower(split_part(name, ' ', 2)) FROM users WHERE id != ?`,
    actor.employee_id ?? 0,
    actor.id,
  );
  const words = new Set(t.split(/[^a-z]+/).filter((w) => w.length >= 3 && !ownNames.has(w)));
  const namesOther = people.some((p) => (p.a && words.has(p.a)) || (p.b && words.has(p.b)));
  // "X's salary" / "X ki tankhwa" about anyone other than "my"/"meri".
  const possessive = /\b(?!my\b|mine\b|meri\b|mera\b)[a-z]+('s|’s)\s+(salary|pay|payslip|income|package)|\b(?!meri\b|mera\b)[a-z]+\s+(ki|ka)\s+(salary|tankhwa|tankhah|pay)/.test(t);
  const others = /(colleague|coworker|co-worker|manager|boss|someone|everyone|others|team'?s|their|his|her)\b/.test(t);
  if (!namesOther && !possessive && !others) return null;
  return "Sorry, I can't share another employee's salary or personal details. I can help with your own payslips, attendance and leave.";
}

const chatSchema = z.object({
  message: z.string().trim().min(1, 'Type a question').max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .default([]),
});

export async function chat(actor, input) {
  const { message, history } = parse(chatSchema, input);
  await enforceRateLimit(actor);
  const started = Date.now();

  const refusal = await colleagueSalaryGuard(actor, message);
  if (refusal) {
    await logAi(actor, 'chat', { prompt: message, response: refusal, status: 'refused', provider: 'guard', started });
    return { reply: refusal, provider: 'guard', ai_generated: true, tools: [], refused: true };
  }

  if (aiConfigured()) {
    try {
      const out = await chatWithModel(actor, message, history);
      await logAi(actor, 'chat', { prompt: message, tools: out.tools, response: out.reply, status: 'ok', provider: config.ai.model, started });
      return { ...out, provider: 'llm', model: config.ai.model, ai_generated: true };
    } catch (e) {
      if (!(e instanceof AiUnavailable)) throw e;
      console.warn('[ai] falling back to offline assistant:', e.message);
      const out = await localAnswer(actor, message);
      await logAi(actor, 'chat', { prompt: message, tools: out.tools, response: `${out.reply} [fallback: ${e.message}]`, status: 'fallback', provider: 'offline', started });
      return { ...out, provider: 'offline', ai_generated: true, notice: FRIENDLY_FALLBACK };
    }
  }
  const out = await localAnswer(actor, message);
  await logAi(actor, 'chat', { prompt: message, tools: out.tools, response: out.reply, status: 'ok', provider: 'offline', started });
  return { ...out, provider: 'offline', ai_generated: true };
}

async function chatWithModel(actor, message, history) {
  const signal = deadline();
  const messages = [
    { role: 'system', content: await chatSystemPrompt(actor) },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
    { role: 'user', content: message },
  ];
  const tools = toolSchemas(actor);
  const used = [];
  let action = null;
  for (let round = 0; round < 5; round++) {
    const msg = await chatCompletion({ messages, tools, signal });
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const reply = (msg.content || '').trim();
      if (!reply) throw new AiUnavailable('Empty answer from model');
      return { reply, tools: used, action };
    }
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
    for (const c of calls) {
      let args = {};
      try {
        args = JSON.parse(c.function?.arguments || '{}');
      } catch {
        args = {};
      }
      const result = await runTool(actor, c.function?.name, args);
      used.push(c.function?.name);
      if (c.function?.name === 'draft_leave_request' && result?.ok) action = { type: 'leave_draft', draft: result.draft, warnings: result.warnings };
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.function?.name, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  throw new AiUnavailable('Too many tool rounds');
}

// ---- Dashboard summary (Admin, HR) ----

const summarySchema = z.object({ from: isoDate.optional(), to: isoDate.optional(), department_id: z.coerce.number().int().positive().optional() });

function compactKpis(role, d) {
  if (role === 'admin') {
    return {
      period: { from: d.filters.from, to: d.filters.to },
      headcount: d.kpis.headcount,
      attrition_ytd_pct: d.kpis.attrition_ytd.rate,
      exits_ytd: d.kpis.attrition_ytd.exits,
      payroll_cost: d.kpis.payroll_cost,
      avg_monthly_gross_salary: d.kpis.avg_salary,
      pending_approvals: d.kpis.pending_approvals.total,
      attendance_rate_pct: d.attendance.attendance_rate,
      absenteeism_pct: d.attendance.absenteeism_pct,
      headcount_by_dept: d.headcount_by_dept.map((x) => ({ department: x.department, headcount: x.headcount })),
      payroll_by_dept: d.payroll_by_dept,
      tenure: d.tenure,
    };
  }
  return {
    period: { from: d.filters.from, to: d.filters.to },
    headcount: d.kpis.headcount,
    today: { present: d.kpis.today.present, late: d.kpis.today.late, on_leave: d.kpis.today.on_leave, not_marked: d.kpis.today.not_marked },
    pending_approvals: d.kpis.pending_approvals,
    attendance_rate_pct: d.attendance.attendance_rate,
    late_pct: d.attendance.late_pct,
    absenteeism_pct: d.attendance.absenteeism_pct,
    counts: d.attendance.counts,
    by_department: d.by_department,
    leave_days_by_type: d.leave_by_type,
    top_late: d.top_late.map((x) => ({ name: x.name, late_count: x.late_count })),
    absence_flags: d.insights.anomalies.map((a) => ({ name: a.name, reasons: a.reasons })),
    attrition_risk: d.insights.attrition_risk.map((r) => ({ name: r.name, score: r.score, level: r.level })),
  };
}

function fallbackBullets(role, k) {
  const b = [];
  const n = (v) => (v == null ? 'n/a' : v);
  if (role === 'admin') {
    b.push(`Headcount is ${k.headcount} with ${k.exits_ytd} exit(s) this year (attrition ${k.attrition_ytd_pct}%).`);
    b.push(`Payroll cost in the period: gross ${k.payroll_cost.gross}, net ${k.payroll_cost.net} across ${k.payroll_cost.months} month(s).`);
    b.push(`Average monthly gross salary is ${n(k.avg_monthly_gross_salary)}.`);
    b.push(`Attendance rate ${n(k.attendance_rate_pct)}%, absenteeism ${n(k.absenteeism_pct)}%; ${k.pending_approvals} approval(s) pending.`);
    const biggest = [...k.headcount_by_dept].sort((a, c) => c.headcount - a.headcount)[0];
    if (biggest?.headcount) b.push(`${biggest.department} is the largest department with ${biggest.headcount} people.`);
  } else {
    b.push(`Attendance rate ${n(k.attendance_rate_pct)}% for ${k.period.from} to ${k.period.to}; absenteeism ${n(k.absenteeism_pct)}%, late ${n(k.late_pct)}%.`);
    b.push(`Today: ${k.today.present} present, ${k.today.late} late, ${k.today.on_leave} on leave, ${k.today.not_marked} not checked in yet.`);
    b.push(`${k.pending_approvals.leave} leave request(s) and ${k.pending_approvals.corrections} correction(s) waiting for approval.`);
    if (k.top_late[0]) b.push(`Most late arrivals: ${k.top_late[0].name} (${k.top_late[0].late_count}).`);
    const worst = [...k.by_department].sort((a, c) => c.absenteeism_pct - a.absenteeism_pct)[0];
    if (worst && worst.absenteeism_pct > 0) b.push(`Highest absenteeism: ${worst.department} at ${worst.absenteeism_pct}%.`);
  }
  return b.slice(0, 5);
}

const bulletsSchema = z.object({ bullets: z.array(z.string().trim().min(5).max(300)).min(3).max(5) });

export async function dashboardSummary(actor, input) {
  if (!['admin', 'hr'].includes(actor.role)) throw forbidden('Dashboard summaries are for Admin and HR');
  const filters = parse(summarySchema, input);
  await enforceRateLimit(actor);
  const started = Date.now();
  // KPIs are recomputed on the server for the current filters; the browser cannot inject numbers.
  const dash = actor.role === 'admin' ? await adminDashboard(filters) : await hrDashboard(filters);
  const kpis = compactKpis(actor.role, dash);
  if (aiConfigured()) {
    const signal = deadline();
    const messages = [
      {
        role: 'system',
        content:
          'You write short HR dashboard insights. Use ONLY the numbers in the KPI JSON; never invent or estimate numbers. ' +
          'Return JSON exactly like {"bullets": ["...", "..."]} with 3 to 5 bullets, each one sentence, most important first. Mention concrete numbers and suggest an action where useful.',
      },
      { role: 'user', content: `KPI JSON (${actor.role} dashboard):\n${JSON.stringify(kpis)}` },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const msg = await chatCompletion({ messages, json: true, signal });
        const parsed = bulletsSchema.safeParse(JSON.parse(msg.content || '{}'));
        if (parsed.success) {
          await logAi(actor, 'summary', { prompt: JSON.stringify(filters), response: JSON.stringify(parsed.data.bullets), status: 'ok', provider: config.ai.model, started });
          return { bullets: parsed.data.bullets, kpis, provider: 'llm', ai_generated: true };
        }
        messages.push({ role: 'assistant', content: msg.content || '' }, { role: 'user', content: 'That was not valid. Reply with JSON {"bullets": [3-5 strings]} only.' });
      } catch (e) {
        if (!(e instanceof AiUnavailable) && !(e instanceof SyntaxError)) throw e;
        if (e instanceof AiUnavailable) break;
      }
    }
  }
  const bullets = fallbackBullets(actor.role, kpis);
  await logAi(actor, 'summary', { prompt: JSON.stringify(filters), response: JSON.stringify(bullets), status: aiConfigured() ? 'fallback' : 'ok', provider: 'offline', started });
  return { bullets, kpis, provider: 'offline', ai_generated: true, notice: aiConfigured() ? FRIENDLY_FALLBACK : undefined };
}

// ---- Smart leave: plain words -> validated draft (never saved) ----

const smartSchema = z.object({ text: z.string().trim().min(3, 'Describe the leave you need').max(500) });

export async function smartLeave(actor, input) {
  const { text } = parse(smartSchema, input);
  if (!actor.employee_id) throw forbidden('This login has no employee profile, so it cannot apply for leave.');
  await enforceRateLimit(actor);
  const started = Date.now();
  const s = await getSettings();
  const today = zonedNow(s.timezone).date;
  const codes = (await all('SELECT code FROM leave_types WHERE is_active ORDER BY id')).map((r) => r.code);
  const draftSchema = z.object({
    type: z.string().transform((v) => v.toLowerCase()).refine((v) => codes.includes(v), 'Unknown leave type'),
    start: isoDate,
    end: isoDate,
    reason: z.string().trim().min(1).max(300),
  }).refine((d) => d.start <= d.end, 'start after end');

  let parsed = null;
  let provider = 'offline';
  if (aiConfigured()) {
    const signal = deadline();
    const messages = [
      {
        role: 'system',
        content:
          `Convert a leave request into JSON {"type": one of ${JSON.stringify(codes)}, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "reason": "short reason"}. ` +
          `Today is ${today}. "Next Monday" means the first Monday after today. Weddings, family events and personal errands are casual; illness is sick; trips and vacations are annual. ` +
          `The text may be in Roman Urdu. Reply with the JSON only.\nCalendar:\n${calendarHint(today, 30)}`,
      },
      { role: 'user', content: text },
    ];
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const msg = await chatCompletion({ messages, json: true, signal, temperature: 0 });
        const r = draftSchema.safeParse(JSON.parse(msg.content || '{}'));
        if (r.success) {
          parsed = { type: r.data.type, start_date: r.data.start, end_date: r.data.end, reason: r.data.reason };
          provider = 'llm';
        } else {
          messages.push({ role: 'assistant', content: msg.content || '' }, { role: 'user', content: `Invalid: ${r.error.issues[0].message}. Reply with the JSON only.` });
        }
      } catch (e) {
        if (e instanceof AiUnavailable) break;
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
  }
  if (!parsed) parsed = await smartLeaveLocal(actor, text);
  if (!parsed || !isISODate(parsed.start_date)) {
    await logAi(actor, 'smart_leave', { prompt: text, response: 'no dates found', status: 'failed', provider, started });
    return { ok: false, message: "I couldn't work out the dates. Please fill in the form below.", ai_generated: true };
  }
  const result = await draftLeave(actor, parsed);
  await logAi(actor, 'smart_leave', { prompt: text, tools: ['draft_leave_request'], response: JSON.stringify(result.draft || result), status: result.ok ? 'ok' : 'failed', provider, started });
  return { ...result, provider, ai_generated: true };
}

export async function listAiLogs({ limit = 50 } = {}) {
  return all(
    `SELECT l.id, l.feature, l.prompt, l.status, l.provider, l.latency_ms, l.created_at, u.name AS user_name, u.role
       FROM ai_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ?`,
    Math.min(200, Number(limit) || 50),
  );
}
