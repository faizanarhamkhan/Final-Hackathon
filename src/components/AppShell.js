'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell, Building2, CalendarCheck, CalendarDays, ClipboardList, FileText, LayoutDashboard, LogOut, Megaphone,
  Menu, Moon, Settings, ShieldCheck, Sun, User, Users, UserCog, Wallet, KeyRound, X,
} from 'lucide-react';
import { useAuth, useTheme } from './AuthProvider';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Loading } from './ui';
import { ChatPanel } from './ChatPanel';

function navFor(user) {
  const own = user.employee_id
    ? [
        { section: 'My space' },
        { href: '/my/attendance', label: 'My attendance', icon: CalendarCheck },
        { href: '/my/leave', label: 'My leave', icon: CalendarDays },
        { href: '/my/payslips', label: 'My payslips', icon: FileText },
        { href: '/my/profile', label: 'My profile', icon: User },
      ]
    : [];
  if (user.role === 'admin') {
    return [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { section: 'Company' },
      { href: '/settings', label: 'Company settings', icon: Settings },
      { href: '/organization', label: 'Organization', icon: Building2 },
      { href: '/users', label: 'Users & logins', icon: UserCog },
      { section: 'People' },
      { href: '/employees', label: 'Employees', icon: Users },
      { href: '/attendance', label: 'Attendance', icon: CalendarCheck },
      { href: '/leave', label: 'Leave', icon: CalendarDays },
      { href: '/payroll', label: 'Payroll', icon: Wallet },
      { section: 'Communication' },
      { href: '/announcements', label: 'Announcements', icon: Megaphone },
      { href: '/audit', label: 'Audit log', icon: ShieldCheck },
    ];
  }
  if (user.role === 'hr') {
    return [
      { href: '/dashboard', label: 'HR dashboard', icon: LayoutDashboard },
      { section: 'People operations' },
      { href: '/employees', label: 'Employees', icon: Users },
      { href: '/attendance', label: 'Attendance', icon: CalendarCheck },
      { href: '/leave', label: 'Leave approvals', icon: ClipboardList },
      { href: '/payroll', label: 'Payroll', icon: Wallet },
      { href: '/announcements', label: 'Announcements', icon: Megaphone },
      { section: 'Company (view only)' },
      { href: '/organization', label: 'Organization', icon: Building2 },
      { href: '/settings', label: 'Company rules', icon: Settings },
      ...own,
    ];
  }
  return [
    { href: '/dashboard', label: 'My dashboard', icon: LayoutDashboard },
    ...own.slice(1),
    { href: '/announcements', label: 'Announcements', icon: Megaphone },
  ];
}

function Notifications() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ rows: [], unread: 0 });
  const ref = useRef(null);

  const load = () => api('notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function openItem(n) {
    if (!n.read_at) await api(`notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    setOpen(false);
    load();
    if (n.link) router.push(n.link);
  }

  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-ghost icon-btn" style={{ position: 'relative' }} onClick={() => (setOpen(!open), load())} aria-label="Notifications">
        <Bell size={18} />
        {data.unread > 0 && <span className="dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="dropdown-menu">
          <div className="card-head">
            <strong>Notifications</strong>
            {data.unread > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => api('notifications/read-all', { method: 'POST' }).then(load)}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {data.rows.length === 0 && <div className="empty">No notifications</div>}
            {data.rows.map((n) => (
              <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                {n.body && <div className="muted" style={{ fontSize: 12.5 }}>{n.body}</div>}
                <div className="muted" style={{ fontSize: 11 }}>{fmtDateTime(n.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }) {
  const { user, ready, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace('/login');
    else if (user.must_change_password) router.replace('/change-password');
  }, [ready, user, router]);
  useEffect(() => setMenuOpen(false), [pathname]);
  // Keep the page behind the drawer from scrolling, and allow Escape to close it.
  useEffect(() => {
    document.body.classList.toggle('no-scroll', menuOpen);
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [menuOpen]);

  if (!ready || !user || user.must_change_password) return <Loading />;
  const nav = navFor(user);

  return (
    <div className="shell">
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">H</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.settings.company_name || 'HCM Lite'}</strong>
            <small>HCM Lite</small>
          </div>
          <button className="btn btn-ghost icon-btn sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        {nav.map((n, i) =>
          n.section ? (
            <div key={`s${i}`} className="nav-section">
              {n.section}
            </div>
          ) : (
            <Link key={n.href} href={n.href} className={`nav-link ${pathname === n.href || (n.href !== '/dashboard' && pathname.startsWith(`${n.href}/`)) ? 'active' : ''}`}>
              <n.icon size={17} /> {n.label}
            </Link>
          ),
        )}
        <div className="sidebar-foot">Time zone {user.settings.timezone}</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <span className={`role-pill role-${user.role}`}>{user.role}</span>
          <div className="spacer" />
          <button className="btn btn-ghost icon-btn" onClick={toggle} aria-label="Toggle dark mode" title="Dark mode">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Notifications />
          <div className="hide-sm" style={{ textAlign: 'right', lineHeight: 1.2 }}>
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <small>{user.email}</small>
          </div>
          <Link className="btn btn-ghost icon-btn" href="/change-password" title="Change password" aria-label="Change password">
            <KeyRound size={17} />
          </Link>
          <button className="btn btn-ghost icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
      <ChatPanel />
    </div>
  );
}

// Client-side convenience only; the API enforces roles on every request.
export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) {
    return (
      <div className="card card-body">
        <h2>No access</h2>
        <p className="muted">Your role ({user.role}) cannot open this page.</p>
      </div>
    );
  }
  return children;
}
