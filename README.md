# HCM Lite — AI-assisted Human Capital Management

Saylani Hackathon, 24 October 2026. A web app for **Admin, HR and Employees**: employees, web and camera check-in, leave with approvals, monthly payroll with PDF payslips, dashboards, and an AI assistant that answers from live data with the same permissions as the user.

**The system starts empty.** There is no dummy data. Admin sets up the company, HR registers employees, and every number comes from what people do in the app.

| | |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, plain JavaScript, Recharts, lucide icons, custom CSS (light/dark, responsive from 375 px) |
| Backend | Next.js route handler → module routes → services (all business rules) → data. JWT (HS256, `jose`) + bcrypt |
| Database | **Supabase Postgres** (via `DATABASE_URL`). Without it, an embedded Postgres (PGlite) is used so it runs with zero setup |
| AI | Any OpenAI-compatible API with tool calling (Groq / Gemini / OpenRouter free tiers), called **only from the server** |
| Tests | `node:test`: 16 tests covering rules and the full demo flow against a real Postgres engine |

---

## Run it in under 10 minutes

Requires **Node.js 20.9+**.

```bash
npm install
cp .env.example .env.local      # optional: works with an empty file too
npm run build && npm start      # http://localhost:3000
# or for development: npm run dev
```

Open http://localhost:3000. A fresh install shows the **first-run setup** screen, where you enter the company name and the Admin account.

* With no `DATABASE_URL`, data lives in `.data/pglite`. Delete that folder for a brand-new install.
* With no `AI_API_KEY`, the **built-in assistant** answers: same tools, same permissions, English and Roman Urdu. Add a key for the full LLM experience.

### Create the first Admin

Use either option:

1. **Setup screen** (default): fill in company name, time zone, your name, email and password.
2. **Env file**: set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and optionally `COMPANY_NAME`. The Admin is created on first boot and the setup screen is skipped.

After that, Admin creates **HR logins** (Users & logins). **HR registers employees**, which creates each employee's login with a **temporary password**. Every new user must change it at first sign-in.

### Set the AI key

In `.env.local` (or your hosting provider's environment settings):

```
AI_API_KEY=gsk_...                                   # Groq free key: https://console.groq.com/keys
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
```

Gemini instead: `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `AI_MODEL=gemini-2.5-flash`.

### Use Supabase

1. Create a Supabase project. In the dashboard, open **Connect** and copy the **Transaction pooler** URI (port 6543).
2. Set `DATABASE_URL=postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:6543/postgres`.
3. Start the app. **The schema is created automatically** on first connection (idempotent). If you prefer, run `supabase/migrations/0001_init.sql` in the SQL editor yourself.

The browser never talks to Supabase directly, so the anon/service keys are not needed. Row Level Security is enabled on every table, which means the public anon key cannot read anything.

### Deploy (free): Vercel + Supabase

1. Push the repo to GitHub and import it in Vercel (framework: Next.js; the defaults are fine).
2. Add environment variables: `DATABASE_URL` (Supabase pooler URI), `JWT_SECRET`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`.
3. Deploy. The live link opens on the **first-run setup** screen, so judges can create the company themselves.

> Commit `.env.example` only, never `.env.local`. On Vercel, always set `DATABASE_URL`. The embedded database is for local use; serverless disks are not persistent.

---

## 5-minute demo script

1. **Admin**: complete setup. Then go to **Company settings**: office hours 09:00, grace 15 min, and *Use my current location* with a 150 m radius. In **Organization**, add a department; the leave types (annual 14 / sick 8 / casual 10 / unpaid) are ready to edit. In **Users & logins**, create an HR login.
2. **HR**: sign in with the temporary password and change it. In **Employees → Register employee**, add two or three people. Each gets a login and temporary password.
3. **Employee**: sign in, change the password, and **Check in** on the dashboard (or use **Camera check-in**).
4. **Employee → My leave → Smart leave**: type *"I need next Monday and Tuesday off for my sister's wedding"*. You get a pre-filled **casual** leave for the correct dates. Confirm it. Then **HR → Leave approvals → Approve**.
5. **HR dashboard**: click **Summarize**, then ask the assistant *"Who is on leave today?"*. Go to **Payroll**, create the draft for the month. **Admin → Payroll** opens the run and clicks **Finalize** (the month is now locked).
6. **Employee**: **My payslips → PDF**. Ask the assistant *"What is Ali's salary?"* and it is politely refused. **Admin → Audit log** shows every action.

---

## What is built (25/25 functionalities)

| # | Functionality | Admin | HR | Employee | Where |
|---|---|---|---|---|---|
| 01 | First-run setup | Manage | — | — | `/setup`, `ADMIN_EMAIL` env |
| 02 | Login, logout, change password, role menus | Own | Own | Own | JWT, forced change on temp password |
| 03 | Company settings (hours, grace, weekend, location, radius) | Manage | View | — | `/settings` |
| 04 | Departments, designations, leave types + quotas, holidays | Manage | View | — | `/organization` |
| 05 | Create HR logins, deactivate / reset any login | Manage | — | — | `/users` |
| 06 | Register employee (creates login), edit details | View | Manage | Own phone & address | `/employees`, `/my/profile` |
| 07 | Directory with server-side search / filters / paging, Employee 360 | All | All | Own | `/employees`, `/employees/[id]` |
| 08 | CSV import with dry run (row + field + reason), CSV export | — | Manage | — | Employees page |
| 09 | Web check-in / out (server-stamped, second check-in = 409) | — | Own | Own | Dashboard, `/my/attendance` |
| 10 | Attendance calendar and daily board | All | All | Own | `/attendance`, `/my/attendance` |
| 11 | Attendance correction: request / approve | View | Approve | Request | `/attendance?tab=corrections` |
| 12 | Apply / cancel leave, balance and history | — | Own | Own | `/my/leave` |
| 13 | Approve / reject leave with comment (no self-approval) | View | Approve | — | `/leave` |
| 14 | Salary structure per employee | View | Manage | — | Employee 360 → Salary |
| 15 | Monthly payroll draft (create / recalculate / review) | View | Manage | — | `/payroll` |
| 16 | Finalize payroll (locks the month, DB trigger too) | Manage | — | — | `/payroll/[id]` |
| 17 | Payslips with PDF download | All | All | Own (finalized) | `/my/payslips` |
| 18 | Dashboards, KPIs, trends, insights with date + department filters | Company | HR | Personal | `/dashboard` |
| 19 | AI chat answering from real data | All data | HR data | Own data | Chat button (every page) |
| 20 | AI dashboard summary (3–5 bullets from server-computed KPIs) | Yes | Yes | — | Dashboard → Summarize |
| 21 | Smart leave: sentence → validated, pre-filled form | — | Own | Own | `/my/leave`, chat |
| 22 | Policy Q&A from the rules | Yes | Yes | Yes | Chat |
| 23 | Announcements | Post | Post | Read | `/announcements`, dashboards |
| 24 | In-app notifications (leave decisions, payslips, requests) | Own | Own | Own | Bell icon |
| 25 | Audit log (actor, action, entity, before/after JSON; append-only) | View | — | — | `/audit` |

### Bonus features

* **Camera attendance (web, works in phone browsers).** MediaPipe face landmarker requires exactly one face plus a **blink liveness check**. The browser sends GPS with accuracy. The **server** rejects the check-in if there are 0 or more than 1 faces, accuracy is worse than 100 m, or the Haversine distance exceeds the radius. No photo is stored.
* **Attrition risk score.** An explainable score from absenteeism, lateness, unpaid leave, probation and tenure.
* **Absence anomaly flags.** Flags 3+ absences, 2x the team average, Monday/Friday patterns, and repeated lateness.
* **Late penalty rule.** 3 lates = 0.5 day deduction (toggle in Company settings).
* **Roman Urdu.** The assistant and smart-leave parser understand *kal, parson, chutti, bemar, shaadi, peer/mangal...*.
* **Dark mode** (follows the system, with a toggle) and an installable **PWA manifest**.

---

## Business rules (from the brief)

* **Attendance.** The server stamps the time. Arriving after start + grace (09:15) is *late*. Under 5 h worked is a *half day*. A past working day with no record and no approved leave is *absent*. A check-in with no check-out becomes *missing_checkout*. Each record stores the rules it was evaluated with, so **changing settings only affects new records**. Weekend and holiday check-ins are allowed and count as worked.
* **Leave.** Counted in working days only (weekends and holidays skipped). Overlaps or requests over the balance return **422**. Approval re-checks balance and overlap. *Remaining = quota − approved*. Pending days block new requests.
* **Payroll.** Gross = basic + 40% HRA + 10% medical (= 1.5 × basic). Per day = gross ÷ working days in the month. Deductions = per day × (absent + unpaid leave + 0.5 × half days [+ late penalty]). Joiners and leavers are prorated by the working days they were employed. Tax uses the slab on (prorated gross × 12): 0 → 600k; 5% → 1.2M; 30k + 15% → 2.4M; 210k + 25% → 3.6M; 510k + 35% above, then ÷ 12. HR drafts; **only Admin finalizes**; finalized runs are locked in the service **and** by a Postgres trigger.
* **Metrics** (`src/server/services/attendance.js` → `summarize`, `analytics.js`):
  * Attendance rate = (present + late + missing_checkout + 0.5 × half_day) ÷ (working-day records − on_leave).
  * Late % = late ÷ (present + late).
  * Absenteeism = absent ÷ expected days.
  * Attrition = exits ÷ average headcount × 100.
  * Leave utilization = approved days ÷ quota.

**One status engine.** `dayStatuses()` is the only place that decides each employee-day. Payroll, dashboards, calendars and the AI tools all read from it, so **AI answers always match the dashboard**.

---

## AI assistant (M8)

* `POST /api/ai/chat`. The model picks a tool, the backend runs it **with the user's role and data scope**, and the model writes the answer. Tools: `get_headcount`, `get_attendance_summary`, `get_late_comers`, `get_leave_summary`, `get_my_leave_balance`, `get_payroll_summary`, `search_employees`, plus `draft_leave_request` (prepares a form, never saves).
* Tools reuse the same services and permission checks as the REST API. Employees only receive tools scoped to their own `employee_id`. The model never touches the database.
* An Employee asking about another person's salary is **refused before any model call** (deterministic guard), and the tools could not return it anyway.
* **Policy Q&A.** The rules above are generated from live settings into the system prompt. The model answers only from them or says it does not know.
* **Smart leave.** The model must return JSON `{type, start, end, reason}`. It is validated with zod and retried once, then falls back to the built-in parser, then to the normal form. The draft is checked against real balance, overlap and working-day rules before it is shown. **The user confirms.**
* **Guardrails.**
  * `AI_API_KEY` lives only in the server env; the browser never calls the provider.
  * 15 s timeout with a friendly fallback.
  * **20 requests per user per hour**.
  * Every call is logged in `ai_logs` (viewable in Audit log → AI logs).
  * Answers carry an **AI-generated** label.

---

## Security and RBAC

* Every API request goes through `src/server/api.js`, which handles JWT verification, reloads the user (deactivation applies immediately), and checks the route's roles. **Data scope is enforced again inside the services**: `scopedEmployeeId()` pins Employees to their own `employee_id`. Hiding a button is never the only protection.
* Passwords use bcrypt (cost 10). Temporary passwords must be changed before any other API works (`PASSWORD_CHANGE_REQUIRED`). Login is throttled per IP and email.
* The audit log is append-only: there are no update/delete routes, and a Postgres trigger blocks `UPDATE`/`DELETE`. Each entry records actor, role, action, entity, before/after JSON and IP.
* RLS is on for all tables in Supabase, and secrets stay in env only.

## Project structure

```
src/
  app/                      Next.js pages (setup, login, dashboard, employees, attendance, leave, payroll, ...)
    api/[...path]/route.js  single API entry -> src/server/api.js
  components/               UI kit, app shell, chat panel, check-in + camera, charts, forms
  lib/                      browser API client, hooks, formatting
  server/
    api.js                  router: auth -> role guard -> handler -> JSON / file
    routes/index.js         route table per module (M1-M9)
    services/               business rules: setup, auth, users, org, employees, attendance,
                            leave, payroll, analytics, comms, audit, payslipPdf, ai/*
    db/                     schema (Postgres) + Supabase/PGlite adapter, transactions
    lib/                    dates, validation (zod), tax, geo, csv, scope, errors
supabase/migrations/        0001_init.sql (same schema, for the Supabase CLI / SQL editor)
test/                       rules.test.js, flow.test.js (full demo script through the real API)
```

## Tests

```bash
npm test
```

The tests run the real API handler against an in-memory Postgres. They cover:

* Setup and the 409 on a second setup.
* Forced password change.
* RBAC and data scope (an employee gets 403 on other employees).
* Late and half-day rules, and the second check-in returning 409.
* Camera geofence and face count.
* Smart leave dates for "next Monday and Tuesday".
* 422 for overlap, balance and weekend-only leave; no self-approval.
* The judges' AI questions, including the salary refusal.
* Exact payroll numbers, the finalize lock, and payslip PDF access.
* CSV dry-run errors.
* The audit log is immutable.

## Done / not done

**Done:** all 25 functionalities, every business rule in section 3, all three dashboards with filters, AI chat / summary / smart leave / policy Q&A with fallbacks, camera + location attendance in the web app, and the bonus items listed above.

**Not done / limitations**

* No native mobile app (APK/Expo). Camera attendance runs in the web app, including phone browsers.
* Face *matching* to an enrolled face is not implemented; it does detection plus a blink liveness check.
* There is no email sending. Temporary passwords are shown once on screen to the Admin/HR who created the login, who can copy them or download them as CSV after an import.
* PWA support is manifest only (installable); there is no offline cache.
* The tax slab is the illustrative one from the brief and is applied to prorated gross.
