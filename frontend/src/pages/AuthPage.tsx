import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

const Logo = () => (
  <div className="flex items-center gap-2.5">
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </div>
    <span className="text-xl font-bold text-white tracking-tight">FlowShift</span>
  </div>
);

type Tab = 'register' | 'signin' | 'recover';

export function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab]         = useState<Tab>('register');
  const [email, setEmail]     = useState('');
  const [name, setName]       = useState('');
  const [apiKey, setApiKey]   = useState('');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [recoverSent, setRecoverSent] = useState(false);

  function switchTab(t: Tab) {
    setTab(t);
    setError('');
    setRecoverSent(false);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await api.register(email.trim(), name.trim() || undefined);
      localStorage.setItem('flowshift_auth', JSON.stringify({
        userId: user.id,
        apiKey: (user as unknown as Record<string, string>).api_key,
        email: user.email,
        name: user.name,
      }));
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const trimmed = apiKey.trim();
    localStorage.setItem('flowshift_auth', JSON.stringify({ apiKey: trimmed, userId: '', email: '', name: null }));
    try {
      const user = await api.getMe();
      localStorage.setItem('flowshift_auth', JSON.stringify({
        userId: user.id,
        apiKey: trimmed,
        email: user.email,
        name: user.name,
      }));
      navigate('/');
    } catch (err) {
      localStorage.removeItem('flowshift_auth');
      setError(err instanceof Error ? err.message : 'Sign in failed — check your API key');
    } finally {
      setLoading(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.requestRecovery(recoverEmail.trim());
      setRecoverSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery request failed');
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/70 transition-colors text-sm';
  const btnCls =
    'w-full py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2 flex items-center justify-center gap-2';

  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left — branding */}
      <div className="hidden lg:flex flex-col justify-center px-16 w-[55%] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-slate-900 to-violet-950/30" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/20 via-transparent to-transparent" />
        <div className="relative z-10 max-w-lg">
          <Logo />
          <h1 className="mt-10 text-5xl font-bold text-white leading-[1.15] tracking-tight">
            Migrate your<br />
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              iPaaS workflows
            </span><br />
            in minutes.
          </h1>
          <p className="mt-5 text-slate-400 text-lg leading-relaxed">
            Describe your automation. Get a full migration playbook and ready-to-import workflow file — powered by Claude.
          </p>
          <div className="mt-10 flex flex-wrap gap-2">
            {['n8n', 'Make', 'Zapier', 'Tray', 'Boomi', 'Workato', 'Celigo'].map(p => (
              <span key={p} className="px-3.5 py-1.5 bg-white/5 border border-white/8 rounded-full text-slate-400 text-sm font-medium">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center p-8 border-l border-white/5">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8"><Logo /></div>

          {/* Tab switcher — only Register / Sign In visible */}
          {tab !== 'recover' && (
            <div className="flex bg-slate-900 border border-white/8 rounded-xl p-1 mb-8">
              {(['register', 'signin'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => switchTab(t)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                    tab === t ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t === 'register' ? 'Register' : 'Sign In'}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mb-5 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* ── Register ── */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required placeholder="you@example.com" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">
                  Name <span className="text-slate-600 font-normal">— optional</span>
                </label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name" className={inputCls} />
              </div>
              <button type="submit" disabled={loading} className={btnCls}>
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating account…</>
                  : 'Create account →'}
              </button>
            </form>
          )}

          {/* ── Sign In ── */}
          {tab === 'signin' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">API Key</label>
                <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className={inputCls + ' font-mono'} />
              </div>
              <button type="submit" disabled={loading} className={btnCls}>
                {loading
                  ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in…</>
                  : 'Sign in →'}
              </button>
              <p className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => switchTab('recover')}
                  className="text-xs text-slate-500 hover:text-indigo-400 transition-colors underline"
                >
                  Forgot your API key?
                </button>
              </p>
            </form>
          )}

          {/* ── Recover ── */}
          {tab === 'recover' && (
            <div>
              <button
                onClick={() => switchTab('signin')}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm mb-6 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to sign in
              </button>

              {recoverSent ? (
                <div className="text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-white font-semibold mb-2">Check your email</p>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    If <span className="text-slate-300">{recoverEmail}</span> is registered,
                    a recovery link is on its way. The link expires in 15 minutes.
                  </p>
                  <button
                    onClick={() => { setRecoverSent(false); setRecoverEmail(''); }}
                    className="mt-5 text-xs text-slate-500 hover:text-slate-300 underline transition-colors"
                  >
                    Try a different email
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRecover} className="space-y-4">
                  <div>
                    <p className="text-slate-400 text-sm mb-4 leading-relaxed">
                      Enter your registered email and we'll send a recovery link that generates a new API key.
                    </p>
                    <label className="block text-sm font-medium text-slate-400 mb-1.5">Email</label>
                    <input
                      type="email"
                      value={recoverEmail}
                      onChange={e => setRecoverEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      className={inputCls}
                    />
                  </div>
                  <button type="submit" disabled={loading} className={btnCls}>
                    {loading
                      ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending…</>
                      : 'Send recovery link →'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Footer hint */}
          {tab !== 'recover' && (
            <p className="mt-6 text-xs text-slate-600 text-center">
              {tab === 'register'
                ? 'Your API key is shown once after registration — save it.'
                : 'Your API key was returned when you first registered.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
