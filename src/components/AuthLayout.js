import { Bot, CalendarCheck, ShieldCheck, Wallet } from 'lucide-react';

export function AuthLayout({ children, subtitle }) {
  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <div className="brand" style={{ padding: 0, position: 'relative', zIndex: 1 }}>
          <div className="brand-mark">H</div>
          <div>
            <strong>HCM Lite</strong>
            <small>Saylani Hackathon 2026</small>
          </div>
        </div>
        <h1>People operations, with an assistant that knows your data.</h1>
        <p>{subtitle || 'Employees, attendance, leave and payroll for Admin, HR and Employees, with AI answers that always match the dashboard.'}</p>
        <div className="stack hide-sm" style={{ position: 'relative', zIndex: 1, marginTop: 10 }}>
          {[
            [CalendarCheck, 'Web and camera check-in with office geofence'],
            [Wallet, 'Monthly payroll with tax slabs and PDF payslips'],
            [Bot, 'AI chat, dashboard summaries and smart leave'],
            [ShieldCheck, 'Role and data-scope checks on every request'],
          ].map(([Icon, text]) => (
            <div key={text} className="row" style={{ gap: 10 }}>
              <Icon size={18} color="#20c095" /> {text}
            </div>
          ))}
        </div>
      </div>
      <div className="auth-form">
        <div className="auth-card">{children}</div>
      </div>
    </div>
  );
}
