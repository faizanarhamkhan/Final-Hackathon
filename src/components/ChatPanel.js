'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, X, CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { LeaveForm } from './LeaveForm';

const SUGGESTIONS = {
  admin: ['How many active employees are there?', "What is this month's attendance rate?", 'Payroll summary', 'Who is on leave today?'],
  hr: ['Who is on leave today?', 'Who came late most often this month?', "What is this month's attendance rate?", 'How many active employees are in each department?'],
  employee: ['How many sick leaves do I have left this year?', 'I need next Monday and Tuesday off for my sister\'s wedding', 'What is the grace time for check-in?', 'Show my latest payslip'],
};

export function ChatPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [leaveDraft, setLeaveDraft] = useState(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (open && !status) api('ai/status').then(setStatus).catch(() => {});
  }, [open, status]);
  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight);
  }, [messages, busy]);
  useEffect(() => {
    const openChat = () => setOpen(true);
    window.addEventListener('hcm:open-chat', openChat);
    return () => window.removeEventListener('hcm:open-chat', openChat);
  }, []);

  async function send(message) {
    const m = (message ?? text).trim();
    if (!m || busy) return;
    setText('');
    const history = messages.filter((x) => !x.error).map((x) => ({ role: x.role, content: x.content }));
    setMessages((xs) => [...xs, { role: 'user', content: m }]);
    setBusy(true);
    try {
      const r = await api('ai/chat', { method: 'POST', body: { message: m, history } });
      setMessages((xs) => [...xs, { role: 'assistant', content: r.reply, provider: r.provider, tools: r.tools, action: r.action, notice: r.notice }]);
    } catch (e) {
      setMessages((xs) => [...xs, { role: 'assistant', content: e.message || 'Something went wrong. Please try again.', error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const canApply = !!user?.employee_id;
  if (!user) return null;

  return (
    <>
      {!open && (
        <button className="chat-fab" onClick={() => setOpen(true)} aria-label="Open HR assistant">
          <Sparkles size={18} /> Ask HR assistant
        </button>
      )}
      {open && (
        <div className="chat-panel" role="dialog" aria-label="HR assistant">
          <div className="chat-head">
            <Bot size={20} />
            <div style={{ flex: 1, lineHeight: 1.2 }}>
              <strong>HR assistant</strong>
              <div style={{ fontSize: 11.5, opacity: 0.85 }}>
                {status ? (status.configured ? `AI: ${status.model}` : 'Built-in assistant (no AI key set)') : '…'} · sees only what you can see
              </div>
            </div>
            <button className="btn btn-ghost icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X size={18} />
            </button>
          </div>
          <div className="chat-body" ref={bodyRef}>
            {messages.length === 0 && (
              <div className="stack">
                <div className="msg bot">
                  Hi {user.name.split(' ')[0]}! Ask me about attendance, leave, payroll or company rules. I answer from live records{user.role === 'employee' ? ' and only show your own data' : ''}.
                </div>
                <div className="suggestions">
                  {SUGGESTIONS[user.role].map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`} style={m.error ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : undefined}>
                {m.content}
                {m.action?.type === 'leave_draft' && canApply && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn btn-sm btn-accent" onClick={() => setLeaveDraft(m.action)}>
                      <CalendarPlus size={14} /> Review leave form
                    </button>
                  </div>
                )}
                {m.role === 'assistant' && !m.error && (
                  <div className="meta">
                    <span className="ai-label">AI-generated</span>
                    {m.provider === 'offline' && <span>built-in assistant</span>}
                    {m.tools?.length > 0 && <span>used: {[...new Set(m.tools)].join(', ')}</span>}
                    {m.notice && <span>{m.notice}</span>}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="msg bot">
                <span className="spinner" style={{ width: 14, height: 14 }} /> Thinking…
              </div>
            )}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question…" maxLength={1000} aria-label="Message" />
            <button className="btn btn-accent icon-btn" disabled={busy || !text.trim()} aria-label="Send">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
      <LeaveForm
        open={!!leaveDraft}
        draft={leaveDraft?.draft}
        warnings={leaveDraft?.warnings || []}
        onClose={() => setLeaveDraft(null)}
        onSaved={() => {
          setMessages((xs) => [...xs, { role: 'assistant', content: 'Your leave request was submitted to HR for approval.', provider: 'app' }]);
          window.dispatchEvent(new Event('hcm:leave-changed'));
        }}
      />
    </>
  );
}
