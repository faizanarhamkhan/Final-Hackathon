'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, Clock, Coins, Hourglass, TrendingDown, UserCheck, Users, Wallet } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { useApi } from '@/lib/hooks';
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtShortDate, titleCase } from '@/lib/format';
import { Async, Badge, Button, Card, Empty, PageHeader, Stat, Table } from '@/components/ui';
import { BarsChart, DonutChart, LinesChart } from '@/components/Charts';
import { AiSummary, AnnouncementsCard, DashboardFilters } from '@/components/DashboardParts';
import { CheckInWidget } from '@/components/CheckInWidget';

function HrDashboard({ user }) {
  const [filters, setFilters] = useState({});
  const state = useApi('dashboard/hr', filters);
  const d = state.data;
  const cur = user.settings.currency;
  return (
    <>
      <PageHeader title="HR dashboard" subtitle="Live numbers from attendance, leave and employee records" />
      <DashboardFilters value={filters} onChange={setFilters} />
      <Async state={state}>
        {d && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="grid grid-5">
              <Stat label="Headcount" value={d.kpis.headcount} icon={Users} />
              <Stat label="Present today" value={d.kpis.today.present} tone="primary" icon={UserCheck} sub={`${d.kpis.today.not_marked} not checked in yet`} />
              <Stat label="On leave today" value={d.kpis.today.on_leave} tone="warn" icon={CalendarDays} />
              <Stat label="Late today" value={d.kpis.today.late} tone="accent" icon={Clock} />
              <Stat label="Pending approvals" value={d.kpis.pending_approvals.total} icon={Hourglass} sub={`${d.kpis.pending_approvals.leave} leave · ${d.kpis.pending_approvals.corrections} corrections`} />
            </div>
            <div className="grid grid-3">
              <Stat label="Attendance rate" value={fmtPct(d.attendance.attendance_rate)} tone="primary" sub={`${fmtShortDate(d.filters.from)} – ${fmtShortDate(d.filters.to)}`} />
              <Stat label="Absenteeism" value={fmtPct(d.attendance.absenteeism_pct)} tone="danger" sub={`${d.attendance.counts.absent} absent days of ${d.attendance.expected_days}`} />
              <Stat label="Late %" value={fmtPct(d.attendance.late_pct)} tone="warn" sub={`${d.attendance.late_arrivals} late arrivals`} />
            </div>
            <div className="grid grid-2">
              <AiSummary filters={filters} />
              <Card title="Who is on leave today">
                {d.kpis.today.on_leave_list.length ? (
                  <Table columns={[{ key: 'name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'type', label: 'Type' }]} rows={d.kpis.today.on_leave_list} rowKey={(r, i) => i} />
                ) : (
                  <Empty title="Nobody is on leave today" />
                )}
              </Card>
            </div>
            <div className="grid grid-2">
              <Card title="Attendance trend (%)">
                <LinesChart data={d.trend.map((t) => ({ ...t, day: fmtShortDate(t.date) }))} x="day" lines={[{ key: 'rate', label: 'Attendance %' }]} yDomain={[0, 100]} />
              </Card>
              <Card title="Absenteeism and late % by department">
                <BarsChart data={d.by_department} x="department" bars={[{ key: 'absenteeism_pct', label: 'Absenteeism %', color: '#d64545' }, { key: 'late_pct', label: 'Late %', color: '#e8912d' }]} />
              </Card>
            </div>
            <div className="grid grid-3">
              <Card title="Leave days by type">
                <DonutChart data={d.leave_by_type} nameKey="name" valueKey="days" empty="No approved leave in this period" />
              </Card>
              <Card title="Top 5 late-comers" tight>
                <Table
                  columns={[
                    { key: 'name', label: 'Employee' },
                    { key: 'department', label: 'Dept' },
                    { key: 'late_count', label: 'Late', num: true },
                  ]}
                  rows={d.top_late}
                  rowKey={(r) => r.employee_id}
                  empty="No late arrivals"
                />
              </Card>
              <Card title={`Leave utilization ${d.filters.to.slice(0, 4)}`} tight>
                <Table
                  columns={[
                    { key: 'name', label: 'Type' },
                    { key: 'days', label: 'Days used', num: true },
                    { key: 'utilization_pct', label: 'Of quota', num: true, render: (r) => (r.utilization_pct == null ? '—' : fmtPct(r.utilization_pct)) },
                  ]}
                  rows={d.leave_utilization}
                  rowKey={(r) => r.code}
                />
              </Card>
            </div>
            <div className="grid grid-2">
              <Card title={<div className="row"><AlertTriangle size={16} color="var(--warn)" /><h3>Absence anomaly flags</h3></div>}>
                {d.insights.anomalies.length ? (
                  <div className="stack">
                    {d.insights.anomalies.map((a) => (
                      <div key={a.employee_id}>
                        <strong>{a.name}</strong> <small>{a.department}</small>
                        <div className="row" style={{ marginTop: 4 }}>
                          {a.reasons.map((r) => (
                            <Badge key={r} color="orange">{r}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="No unusual absence patterns" />
                )}
              </Card>
              <Card title={<div className="row"><TrendingDown size={16} color="var(--danger)" /><h3>Attrition risk (top 5)</h3></div>}>
                {d.insights.attrition_risk.length ? (
                  <div className="stack">
                    {d.insights.attrition_risk.map((r) => (
                      <div key={r.employee_id} className="row" style={{ justifyContent: 'space-between' }}>
                        <div>
                          <strong>{r.name}</strong> <small>{r.department}</small>
                          <div className="muted" style={{ fontSize: 12 }}>{r.reasons.join(', ') || 'minor signals'}</div>
                        </div>
                        <Badge color={r.level === 'high' ? 'red' : r.level === 'medium' ? 'orange' : 'blue'}>
                          {r.score} · {r.level}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="No risk signals" />
                )}
                <small>Score from absenteeism, lateness, unpaid leave, probation and tenure.</small>
              </Card>
            </div>
            {user.employee_id && <CheckInWidget />}
            <AnnouncementsCard items={d.announcements} />
            <small className="muted">Currency: {cur}. All numbers are computed on the server from the records entered in the app.</small>
          </div>
        )}
      </Async>
    </>
  );
}

function AdminDashboard({ user }) {
  const [filters, setFilters] = useState({});
  const state = useApi('dashboard/admin', filters);
  const d = state.data;
  const cur = user.settings.currency;
  const noSetup = d && d.kpis.headcount === 0;
  return (
    <>
      <PageHeader title="Company dashboard" subtitle={user.settings.company_name} />
      {noSetup && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          Getting started: set office hours and location in <Link href="/settings">Company settings</Link>, add departments and leave types in{' '}
          <Link href="/organization">Organization</Link>, then create an HR login in <Link href="/users">Users &amp; logins</Link>. HR registers employees.
        </div>
      )}
      <DashboardFilters value={filters} onChange={setFilters} />
      <Async state={state}>
        {d && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="grid grid-4">
              <Stat label="Headcount" value={d.kpis.headcount} icon={Users} sub={`as of ${fmtDate(d.filters.to)}`} />
              <Stat label="Attrition YTD" value={fmtPct(d.kpis.attrition_ytd.rate)} tone="danger" icon={TrendingDown} sub={`${d.kpis.attrition_ytd.exits} exit(s), avg headcount ${d.kpis.attrition_ytd.average_headcount}`} />
              <Stat label="Payroll cost (gross)" value={fmtMoney(d.kpis.payroll_cost.gross, cur)} tone="primary" icon={Wallet} sub={`net ${fmtMoney(d.kpis.payroll_cost.net, cur)} · ${d.kpis.payroll_cost.months} run(s)`} />
              <Stat label="Average salary" value={fmtMoney(d.kpis.avg_salary, cur)} tone="accent" icon={Coins} sub="mean monthly gross" />
            </div>
            <div className="grid grid-2">
              <AiSummary filters={filters} />
              <Card title="Audit feed" actions={<Link href="/audit" className="btn btn-sm">Open log</Link>} tight>
                <Table
                  columns={[
                    { key: 'action', label: 'Action', render: (r) => <code>{r.action}</code> },
                    { key: 'actor_name', label: 'By' },
                    { key: 'created_at', label: 'When', render: (r) => new Date(r.created_at).toLocaleString() },
                  ]}
                  rows={d.audit_feed}
                  empty="No activity yet"
                />
              </Card>
            </div>
            <div className="grid grid-2">
              <Card title="Headcount by department">
                <BarsChart data={d.headcount_by_dept} x="department" bars={[{ key: 'headcount', label: 'Headcount' }]} empty="Add departments and employees" />
              </Card>
              <Card title="Payroll cost by department">
                <BarsChart data={d.payroll_by_dept} x="department" bars={[{ key: 'gross', label: 'Gross' }, { key: 'net', label: 'Net' }]} empty="No payroll runs in this period" />
              </Card>
            </div>
            <div className="grid grid-3">
              <Card title="Gender">
                <DonutChart data={d.gender.map((g) => ({ ...g, gender: titleCase(g.gender) }))} nameKey="gender" valueKey="count" />
              </Card>
              <Card title="Tenure">
                <BarsChart data={d.tenure} x="bucket" bars={[{ key: 'count', label: 'Employees' }]} />
              </Card>
              <Card title="Attendance (period)">
                <div className="stack">
                  <div className="stat-value" style={{ color: 'var(--primary)' }}>{fmtPct(d.attendance.attendance_rate)}</div>
                  <small>
                    Absenteeism {fmtPct(d.attendance.absenteeism_pct)} · Late {fmtPct(d.attendance.late_pct)} · {d.kpis.pending_approvals.total} pending approvals
                  </small>
                </div>
              </Card>
            </div>
            <div className="grid grid-2">
              <Card title="Average salary by department" tight>
                <Table
                  columns={[
                    { key: 'department', label: 'Department' },
                    { key: 'headcount', label: 'People', num: true },
                    { key: 'avg_gross', label: 'Avg gross', num: true, render: (r) => fmtMoney(r.avg_gross, cur) },
                  ]}
                  rows={d.avg_salary_by_dept}
                  rowKey={(r) => r.department}
                />
              </Card>
              <Card title="Average salary by designation" tight>
                <Table
                  columns={[
                    { key: 'designation', label: 'Designation' },
                    { key: 'headcount', label: 'People', num: true },
                    { key: 'avg_gross', label: 'Avg gross', num: true, render: (r) => fmtMoney(r.avg_gross, cur) },
                  ]}
                  rows={d.avg_salary_by_designation}
                  rowKey={(r) => r.designation}
                />
              </Card>
            </div>
            <AnnouncementsCard items={d.announcements} />
          </div>
        )}
      </Async>
    </>
  );
}

function EmployeeDashboard({ user }) {
  const state = useApi('dashboard/employee');
  const d = state.data;
  const cur = user.settings.currency;
  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} subtitle={[user.designation, user.department].filter(Boolean).join(' · ')} />
      <Async state={state}>
        {d && (
          <div className="stack" style={{ gap: 16 }}>
            <div className="grid grid-2">
              <CheckInWidget onChange={state.reload} />
              <Card title="This week">
                <div className="stack">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="stat-value">{fmtNum(d.hours_this_week, 1)} h</span>
                    <span className="muted">of {d.hours_target} h</span>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${d.hours_target ? Math.min(100, Math.max(0, (d.hours_this_week / d.hours_target) * 100)) : 0}%` }} />
                  </div>
                  <small>
                    {fmtShortDate(d.week.start)} – {fmtShortDate(d.week.end)}
                  </small>
                  <div className="divider" />
                  <div className="grid grid-2">
                    <Stat label="Late this month" value={d.late_count_month} tone="warn" />
                    <Stat label="Attendance this month" value={fmtPct(d.month.attendance_rate)} tone="primary" />
                  </div>
                </div>
              </Card>
            </div>
            <div className="grid grid-4">
              {d.balances.map((b) => (
                <Stat key={b.code} label={b.name} value={b.remaining ?? '∞'} sub={b.quota == null ? 'unlimited' : `left of ${b.quota}${b.pending ? ` · ${b.pending} pending` : ''}`} />
              ))}
            </div>
            <div className="grid grid-2">
              <Card title="Last payslip" actions={<Link className="btn btn-sm" href="/my/payslips">All payslips</Link>}>
                {d.last_payslip ? (
                  <div className="stack">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>{d.last_payslip.label}</strong>
                      <span className="stat-value" style={{ color: 'var(--primary)' }}>{fmtMoney(d.last_payslip.net, cur)}</span>
                    </div>
                    <small>
                      Gross {fmtMoney(d.last_payslip.gross, cur)} · deductions {fmtMoney(d.last_payslip.deductions, cur)} · tax {fmtMoney(d.last_payslip.tax, cur)}
                    </small>
                  </div>
                ) : (
                  <Empty title="No payslips yet">They appear after payroll is finalized.</Empty>
                )}
              </Card>
              <Card title="Ask my assistant">
                <div className="stack">
                  <p className="muted">Ask about your leave balance or payslip, or type a leave request in plain words.</p>
                  <Button variant="accent" onClick={() => window.dispatchEvent(new Event('hcm:open-chat'))}>
                    Open assistant
                  </Button>
                </div>
              </Card>
            </div>
            <AnnouncementsCard items={d.announcements} />
          </div>
        )}
      </Async>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  if (user.role === 'admin') return <AdminDashboard user={user} />;
  if (user.role === 'hr') return <HrDashboard user={user} />;
  return <EmployeeDashboard user={user} />;
}
