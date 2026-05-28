import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';

export function RecoverPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [status, setStatus]   = useState<'loading' | 'success' | 'error'>('loading');
  const [apiKey, setApiKey]   = useState('');
  const [email, setEmail]     = useState('');
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No recovery token found in the URL. Check your email and try the link again.');
      return;
    }

    api.redeemRecovery(token)
      .then(data => {
        setApiKey(data.api_key);
        setEmail(data.email);
        // Sign the user in immediately with the new key
        localStorage.setItem('flowshift_auth', JSON.stringify({
          userId: data.id,
          apiKey: data.api_key,
          email: data.email,
          name: data.name,
        }));
        setStatus('success');
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Recovery failed');
        setStatus('error');
      });
  }, [token]);

  async function copy() {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-xl font-bold text-white tracking-tight">FlowShift</span>
        </div>

        {status === 'loading' && (
          <div className="bg-slate-900 border border-white/5 rounded-2xl p-8 text-center">
            <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400 text-sm">Verifying your recovery link…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-slate-900 border border-white/5 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-white font-semibold mb-2">Recovery failed</p>
            <p className="text-slate-400 text-sm mb-6">{error}</p>
            <Link
              to="/auth"
              className="text-indigo-400 text-sm underline hover:text-indigo-300 transition-colors"
            >
              ← Back to sign in
            </Link>
          </div>
        )}

        {status === 'success' && (
          <div className="bg-slate-900 border border-white/5 rounded-2xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold">API key reset</p>
                <p className="text-slate-500 text-xs">{email}</p>
              </div>
            </div>

            <p className="text-slate-400 text-sm mb-4">
              Your new API key is below. <strong className="text-white">Save it now</strong> — it won't be shown again.
            </p>

            {/* Key display */}
            <div className="bg-slate-800 border border-white/8 rounded-xl px-4 py-3 flex items-center gap-3 mb-6">
              <code className="flex-1 text-indigo-300 text-sm font-mono break-all">{apiKey}</code>
              <button
                onClick={copy}
                className="shrink-0 text-slate-500 hover:text-slate-200 transition-colors"
                title="Copy"
              >
                {copied
                  ? <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                }
              </button>
            </div>

            <p className="text-slate-600 text-xs mb-6">
              You've been signed in automatically. Your previous API key has been invalidated.
            </p>

            <Link
              to="/"
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-sm font-medium transition-all"
            >
              Go to dashboard →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
