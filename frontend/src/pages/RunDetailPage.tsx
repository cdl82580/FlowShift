import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api';
import type { Run } from '../types';
import { PLATFORM_COLORS } from '../types';

// Platforms whose import files are best-effort approximations due to
// proprietary / poorly-documented formats. n8n and Make are excluded
// (well-documented; files import cleanly). Zapier never generates a file.
const PLATFORM_CAVEATS: Record<string, string> = {
  'Tray':
    "Tray's workflow format is proprietary with limited public documentation. " +
    "The generated file is a best-effort approximation — step definitions and connector " +
    "configurations will likely need manual adjustments before the workflow runs correctly. " +
    "Use the Playbook tab as your primary build guide.",
  'Boomi':
    "Boomi's process format is a complex enterprise schema tied to your specific Atoms, " +
    "connectors, and deployment environment. The generated file is a best-effort approximation " +
    "that will require manual configuration in Boomi before it can be deployed. " +
    "Use the Playbook tab as your primary build guide.",
  'Workato':
    "Workato's recipe format is proprietary and not publicly documented. " +
    "The generated file is a best-effort approximation — trigger and action configurations " +
    "may need manual adjustments in Workato before the recipe runs correctly. " +
    "Use the Playbook tab as your primary build guide.",
  'Celigo':
    "Celigo's flow format is proprietary with account-specific field mappings and scripts. " +
    "The generated file is a best-effort approximation — integrations and mappings will likely " +
    "need manual configuration in Celigo before the flow runs correctly. " +
    "Use the Playbook tab as your primary build guide.",
  'Power Automate':
    "Microsoft's flow format is proprietary and complex. The generated file is a best-effort " +
    "approximation — connections, credentials, and some action parameters will likely need manual " +
    "configuration in Power Automate before the flow runs correctly. " +
    "Use the Playbook tab as your primary build guide.",
};

function PlatformChip({ name }: { name: string }) {
  const cfg = PLATFORM_COLORS[name as keyof typeof PLATFORM_COLORS];
  return (
    <span className={`px-3 py-1.5 rounded-lg text-sm font-bold ${cfg?.bg ?? 'bg-slate-500/10'} ${cfg?.text ?? 'text-slate-400'}`}>
      {name}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    processing: 'bg-amber-500/10  text-amber-400  border-amber-500/20',
    pending:    'bg-slate-500/10  text-slate-400  border-slate-500/20',
    failed:     'bg-red-500/10    text-red-400    border-red-500/20',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? map.pending}`}>
      {status}
    </span>
  );
}

function renderMarkdown(src: string): string {
  const raw = marked.parse(src);
  const html = typeof raw === 'string' ? raw : '';
  return DOMPurify.sanitize(html);
}

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun]           = useState<Run | null>(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<'playbook' | 'import'>('playbook');
  const [copied, setCopied]     = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const pollCount = useRef(0);

  // Initial load with AbortController so navigating away cleans up the fetch
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    api.getRun(id)
      .then(r => { if (!controller.signal.aborted) setRun(r); })
      .catch(e => { if (!controller.signal.aborted) console.error(e); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  // Poll while run is in-flight — stops after ~10 min (200 × 3 s) to avoid infinite loops
  useEffect(() => {
    if (!id || !run) return;
    if (run.status !== 'pending' && run.status !== 'processing') return;
    if (pollCount.current >= 200) { setPollTimedOut(true); return; }

    const timer = setInterval(() => {
      pollCount.current++;
      if (pollCount.current >= 200) {
        clearInterval(timer);
        setPollTimedOut(true);
        return;
      }
      api.getRun(id).then(setRun).catch(console.error);
    }, 3000);
    return () => clearInterval(timer);
  }, [id, run?.status]);

  function downloadFile() {
    if (!run?.import_file_content || !run?.import_file_name) return;
    const blob = new Blob([run.import_file_content], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = run.import_file_name; a.click();
    URL.revokeObjectURL(url);
  }

  async function copyFile() {
    if (!run?.import_file_content) return;
    await navigator.clipboard.writeText(run.import_file_content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  );

  if (!run) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-slate-400 mb-3">Run not found.</p>
        <Link to="/" className="text-indigo-400 text-sm underline">Back to dashboard</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-3 text-sm">
          <Link to="/" className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="text-slate-600">Dashboard</span>
          <svg className="w-3.5 h-3.5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-white font-mono">{run.id.slice(0, 8)}…</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Summary card */}
        <div className="bg-slate-900 border border-white/5 rounded-2xl p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              {run.source ? (
                <>
                  <PlatformChip name={run.source} />
                  <svg className="w-4 h-4 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </>
              ) : (
                <span className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-500/10 text-indigo-400">Build Guide</span>
              )}
              <PlatformChip name={run.destination} />
              <StatusBadge status={run.status} />
            </div>
            <div className="flex items-center gap-2">
              {run.gdrive_run_folder_url && (
                <a
                  href={run.gdrive_run_folder_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-white/5 text-slate-300 rounded-lg text-sm transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6.28 3l5.72 9.9L6.28 21H1.8L7.52 12 1.8 3zM8.5 3h5l5.72 9-2.86 4.95L11.5 12 8.5 3zm8.7 0h5.02L17.5 12l-5.28 9H7.2l5.72-9.9z"/>
                  </svg>
                  Drive
                </a>
              )}
              {run.has_import_file && (
                <button
                  onClick={downloadFile}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-sm font-medium transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download .{run.import_file_extension}
                </button>
              )}
            </div>
          </div>
          {PLATFORM_CAVEATS[run.destination] && run.status === 'completed' && run.has_import_file && (
            <div className="mt-4 flex items-start gap-3 px-4 py-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-amber-300/80 text-xs leading-relaxed">
                <strong className="text-amber-300 font-semibold">{run.destination} import note: </strong>
                {PLATFORM_CAVEATS[run.destination]}
              </p>
            </div>
          )}

          <div className="mt-3 text-xs text-slate-600">
            {new Date(run.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            {run.completed_at && (
              <> · Completed {new Date(run.completed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</>
            )}
          </div>
          {run.description && (
            <div
              className="mt-3 prose prose-invert prose-sm max-w-none bg-white/3 rounded-lg px-4 py-3 border border-white/5
                prose-p:text-slate-400 prose-p:my-1 prose-headings:text-slate-300 prose-headings:font-semibold
                prose-strong:text-slate-300 prose-li:text-slate-400 prose-code:text-indigo-300
                prose-code:bg-indigo-500/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                prose-code:before:content-none prose-code:after:content-none
                prose-a:text-indigo-400 prose-blockquote:text-slate-500 prose-blockquote:border-slate-600"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(run.description) }}
            />
          )}
        </div>

        {/* In-flight state */}
        {(run.status === 'processing' || run.status === 'pending') && (
          pollTimedOut ? (
            <div className="bg-slate-800/50 border border-white/8 rounded-xl p-10 text-center">
              <p className="text-slate-300 font-semibold mb-2">This is taking longer than expected</p>
              <p className="text-slate-500 text-sm mb-4">Auto-polling stopped after 10 minutes. Refresh the page to check for an update.</p>
              <button
                onClick={() => { pollCount.current = 0; setPollTimedOut(false); api.getRun(id!).then(setRun).catch(console.error); }}
                className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors"
              >
                Check now
              </button>
            </div>
          ) : (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-10 text-center">
              <div className="w-10 h-10 border-2 border-amber-500/30 border-t-amber-400 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-amber-400 font-semibold">Processing your migration…</p>
              <p className="text-amber-400/50 text-sm mt-1">Usually takes 30–60 seconds. This page will auto-update.</p>
            </div>
          )
        )}

        {/* Failed state */}
        {run.status === 'failed' && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-6">
            <p className="text-red-400 font-semibold mb-1">Run failed</p>
            <p className="text-red-400/60 text-sm">{run.error_message}</p>
          </div>
        )}

        {/* Completed — tabs */}
        {run.status === 'completed' && (
          <>
            <div className="flex gap-1 bg-slate-900 border border-white/5 rounded-xl p-1 mb-5 w-fit">
              <button
                onClick={() => setTab('playbook')}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'playbook' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Playbook
              </button>
              {run.has_import_file && (
                <button
                  onClick={() => setTab('import')}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'import' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Import File
                  <span className="ml-1.5 text-xs opacity-50">.{run.import_file_extension}</span>
                </button>
              )}
            </div>

            {tab === 'playbook' && run.playbook_text && (
              <div className="bg-slate-900 border border-white/5 rounded-2xl px-8 py-8">
                <div
                  className="prose prose-invert prose-sm max-w-none
                    prose-headings:font-bold prose-headings:text-white prose-headings:tracking-tight
                    prose-h1:text-xl prose-h2:text-lg prose-h2:border-b prose-h2:border-white/8 prose-h2:pb-2
                    prose-p:text-slate-300 prose-p:leading-relaxed
                    prose-li:text-slate-300
                    prose-strong:text-white
                    prose-code:text-indigo-300 prose-code:bg-indigo-500/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-slate-800/80 prose-pre:border prose-pre:border-white/8 prose-pre:rounded-xl
                    prose-table:text-sm
                    prose-th:text-slate-300 prose-th:border prose-th:border-white/8 prose-th:px-3 prose-th:py-2 prose-th:bg-white/3
                    prose-td:text-slate-400 prose-td:border prose-td:border-white/8 prose-td:px-3 prose-td:py-2
                    prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline
                    prose-blockquote:border-indigo-500/50 prose-blockquote:text-slate-400"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(run.playbook_text) }}
                />
              </div>
            )}

            {tab === 'import' && run.import_file_content && (
              <div className="bg-slate-900 border border-white/5 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/5 bg-white/2">
                  <span className="text-slate-400 text-xs font-mono">{run.import_file_name}</span>
                  <button
                    onClick={copyFile}
                    className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs transition-colors"
                  >
                    {copied
                      ? <><svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg><span className="text-emerald-400">Copied!</span></>
                      : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Copy</>
                    }
                  </button>
                </div>
                <pre className="overflow-auto max-h-[70vh] p-6 text-xs font-mono text-slate-300 leading-relaxed">
                  <code>{run.import_file_content}</code>
                </pre>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
