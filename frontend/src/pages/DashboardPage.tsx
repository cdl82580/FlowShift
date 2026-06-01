import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import type { RunSummary } from '../types';
import { PLATFORM_COLORS } from '../types';
import { Logo } from '../components/Logo';

function getAuth() {
  try { return JSON.parse(localStorage.getItem('flowshift_auth') || '{}'); }
  catch { return {}; }
}

function ApiKeyBanner() {
  const [visible, setVisible]   = useState(false);
  const [copied,  setCopied]    = useState(false);
  const auth = getAuth();
  const key: string = auth.apiKey || '';

  function copy() {
    navigator.clipboard.writeText(key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-slate-900 border border-white/5 rounded-xl text-sm">
      <span className="text-slate-500 shrink-0">API Key</span>
      <code className="flex-1 font-mono text-xs text-slate-400 truncate">
        {visible ? key : '••••••••-••••-••••-••••-••••••••••••'}
      </code>
      <button onClick={() => setVisible(v => !v)}
        className="text-slate-600 hover:text-slate-300 transition-colors text-xs shrink-0">
        {visible ? 'Hide' : 'Show'}
      </button>
      <button onClick={copy}
        className="text-slate-600 hover:text-slate-300 transition-colors text-xs shrink-0">
        {copied ? <span className="text-emerald-400">Copied!</span> : 'Copy'}
      </button>
    </div>
  );
}

export function PlatformBadge({ name }: { name: string }) {
  const cfg = PLATFORM_COLORS[name as keyof typeof PLATFORM_COLORS];
  if (!cfg) return <span className="text-slate-400 text-sm">{name}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {name}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    processing: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    pending:    'bg-slate-500/10  text-slate-400  border-slate-500/20',
    failed:     'bg-red-500/10    text-red-400    border-red-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? map.pending}`}>
      {status === 'processing' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
      {status}
    </span>
  );
}

function DriveIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6.28 3l5.72 9.9L6.28 21H1.8L7.52 12 1.8 3zM8.5 3h5l5.72 9-2.86 4.95L11.5 12 8.5 3zm8.7 0h5.02L17.5 12l-5.28 9H7.2l5.72-9.9z"/>
    </svg>
  );
}

/** Convert e.g. "claude-opus-4-8" → "Claude Opus 4.8" */
function formatModelName(modelId: string): string {
  const m = modelId.match(/^claude-(\w+)-(\d+)-(\d+)/i);
  if (!m) return modelId;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return `Claude ${family} ${m[2]}.${m[3]}`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!auth?.userId) return;
    try {
      const { runs } = await api.getRuns(auth.userId);
      setRuns(runs);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [auth?.userId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    fetch('/health')
      .then(r => r.json())
      .then(d => { if (d.model) setModel(d.model); })
      .catch(() => {});
  }, []);

  // Poll while any run is in-flight
  useEffect(() => {
    const hasLive = runs.some(r => r.status === 'processing' || r.status === 'pending');
    if (!hasLive) return;
    const id = setInterval(fetchRuns, 5000);
    return () => clearInterval(id);
  }, [runs, fetchRuns]);

  function signOut() {
    localStorage.removeItem('flowshift_auth');
    navigate('/auth');
  }

  const completed  = runs.filter(r => r.status === 'completed').length;
  const inProgress = runs.filter(r => r.status === 'processing' || r.status === 'pending').length;
  const failed     = runs.filter(r => r.status === 'failed').length;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            {model && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium tracking-wide">
                ✦ {formatModelName(model)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-600 text-xs hidden sm:block truncate max-w-[180px]">{auth?.email}</span>
            <button onClick={signOut} className="text-slate-500 hover:text-slate-300 text-xs transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {auth?.name ? `Hey, ${auth.name} 👋` : 'Your Migrations'}
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              AI-powered iPaaS migration playbooks.
            </p>
          </div>
          <button
            onClick={() => navigate('/runs/new')}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-500/20 shrink-0 w-full sm:w-auto"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            New Migration
          </button>
        </div>

        {/* API Key */}
        <ApiKeyBanner />

        {/* Stats (only when there are runs) */}
        {runs.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { label: 'Completed',   value: completed,  color: 'text-emerald-400', bg: 'bg-emerald-400/5  border-emerald-400/10' },
              { label: 'In Progress', value: inProgress, color: 'text-amber-400',   bg: 'bg-amber-400/5   border-amber-400/10'   },
              { label: 'Failed',      value: failed,     color: 'text-red-400',     bg: 'bg-red-400/5     border-red-400/10'     },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`border rounded-xl px-3 py-3 sm:px-5 sm:py-4 ${bg}`}>
                <div className={`text-xl sm:text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-slate-500 text-xs mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-24">
            <div className="w-7 h-7 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-20 border border-white/5 rounded-2xl bg-slate-900/30">
            <div className="w-14 h-14 rounded-full bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-white font-semibold mb-1">No migrations yet</h3>
            <p className="text-slate-500 text-sm mb-5">Describe a workflow and get a full playbook in ~60s.</p>
            <button
              onClick={() => navigate('/runs/new')}
              className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-lg text-sm font-medium"
            >
              Start first migration
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {runs.map(run => (
              <Link
                key={run.id}
                to={`/runs/${run.id}`}
                className="flex items-center justify-between bg-slate-900 border border-white/5 rounded-xl px-4 sm:px-5 py-3.5 sm:py-4 hover:border-indigo-500/25 hover:bg-slate-900/70 transition-all group"
              >
                {/* Left */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {run.source ? (
                      <>
                        <PlatformBadge name={run.source} />
                        <svg className="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500 italic">Build Guide →</span>
                    )}
                    <PlatformBadge name={run.destination} />
                    <StatusBadge status={run.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    {run.original_filename && (
                      <span className="text-slate-600 text-xs font-mono truncate max-w-[160px]">
                        📎 {run.original_filename}
                      </span>
                    )}
                    <span className="text-slate-700 text-xs sm:hidden">
                      {new Date(run.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
                {/* Right */}
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-slate-600 text-xs hidden sm:block">
                    {new Date(run.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  {run.gdrive_run_folder_url && (
                    <a
                      href={run.gdrive_run_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-slate-600 hover:text-indigo-400 transition-colors"
                      title="Open in Drive"
                    >
                      <DriveIcon />
                    </a>
                  )}
                  <svg className="w-4 h-4 text-slate-700 group-hover:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
