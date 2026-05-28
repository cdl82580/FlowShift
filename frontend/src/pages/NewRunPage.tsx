import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { PLATFORMS, PLATFORM_COLORS } from '../types';

function PlatformBtn({ name, selected, onClick }: { name: string; selected: boolean; onClick: () => void }) {
  const cfg = PLATFORM_COLORS[name as keyof typeof PLATFORM_COLORS];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-3 rounded-xl text-sm font-semibold border transition-all ${
        selected
          ? `${cfg.bg} ${cfg.text} border-current/20 ring-1 ring-current/15 shadow-sm`
          : 'bg-slate-900 text-slate-400 border-white/8 hover:border-white/20 hover:text-slate-300'
      }`}
    >
      {selected && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
      {name}
    </button>
  );
}

export function NewRunPage() {
  const navigate = useNavigate();
  const [source, setSource]           = useState('');
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [fileName, setFileName]         = useState<string | null>(null);
  const [fileContent, setFileContent]   = useState<string | null>(null);
  const [pasteContent, setPasteContent] = useState('');
  const [showPaste, setShowPaste]       = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [dragOver, setDragOver]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Read file immediately on drop/select using two strategies:
  // 1. readAsArrayBuffer + TextDecoder (avoids encoding issues)
  // 2. readAsText fallback
  function ingestFile(f: File) {
    setFileName(f.name);
    setFileContent(null);
    setError('');

    const tryArrayBuffer = () => {
      const r2 = new FileReader();
      r2.onload = (ev) => {
        try {
          const buf  = ev.target?.result as ArrayBuffer;
          const text = new TextDecoder('utf-8').decode(buf);
          setFileContent(text);
        } catch {
          onFinalError('DecodeError');
        }
      };
      r2.onerror = () => onFinalError(r2.error?.name ?? 'ReadError');
      r2.readAsArrayBuffer(f);
    };

    const onFinalError = (code: string) => {
      setFileName(null);
      setError(`File read failed (${code}). Paste the content below instead.`);
      setShowPaste(true);
    };

    const r1 = new FileReader();
    r1.onload = (ev) => setFileContent((ev.target?.result as string) ?? '');
    r1.onerror = () => tryArrayBuffer();   // first attempt failed → try buffer
    r1.readAsText(f, 'UTF-8');
  }

  function clearFile() {
    setFileName(null);
    setFileContent(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const effectiveContent = fileContent ?? (pasteContent.trim() || null);
  const effectiveName    = fileName   ?? (pasteContent.trim() ? 'pasted_content.json' : null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !destination) return setError('Select both a source and destination platform.');
    if (source === destination)  return setError('Source and destination must be different platforms.');
    if (!effectiveContent && !description.trim()) return setError('Provide a description or upload a workflow file (or both).');
    setError('');
    setLoading(true);
    try {
      const run = await api.createRun({
        source,
        destination,
        description: description.trim() || undefined,
        fileContent: effectiveContent ?? undefined,
        fileName:    effectiveName    ?? undefined,
      });
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    // Prefer FileSystem API — it acquires a proper security-scoped bookmark on
    // macOS/Safari, which avoids permission errors on files with emoji filenames
    // or files from restricted locations.
    const dtItem = e.dataTransfer.items?.[0];
    if (dtItem?.kind === 'file') {
      const entry = dtItem.webkitGetAsEntry?.();
      if (entry?.isFile) {
        (entry as FileSystemFileEntry).file(
          (f) => ingestFile(f),
          () => fallbackRead(e),   // FileSystem API failed → try legacy path
        );
        return;
      }
      const f = dtItem.getAsFile();
      if (f) { ingestFile(f); return; }
    }
    fallbackRead(e);
  }

  function fallbackRead(e: React.DragEvent) {
    const f = e.dataTransfer.files?.[0];
    if (f) ingestFile(f);
    else setError('Could not read the dropped file. Use the Browse button to select it.');
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-3 text-sm">
          <Link to="/" className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="text-slate-600">Dashboard</span>
          <svg className="w-3.5 h-3.5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-white font-medium">New Migration</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">New Migration</h1>
          <p className="text-slate-500 text-sm mt-1">Select platforms, describe the workflow, and get a full playbook.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Source */}
          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Source Platform
              {source && <span className="ml-2 font-normal text-indigo-400">→ {source}</span>}
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {PLATFORMS.map(p => (
                <PlatformBtn key={p} name={p} selected={source === p} onClick={() => setSource(source === p ? '' : p)} />
              ))}
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Destination Platform
              {destination && <span className="ml-2 font-normal text-indigo-400">→ {destination}</span>}
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {PLATFORMS.map(p => (
                <PlatformBtn key={p} name={p} selected={destination === p} onClick={() => setDestination(destination === p ? '' : p)} />
              ))}
            </div>

            {/* Paste fallback — shown automatically on read error, or manually */}
            {(showPaste || pasteContent) ? (
              <div className="mt-3">
                <label className="block text-xs text-slate-500 mb-1.5">
                  Paste file content here
                  {pasteContent && <span className="text-emerald-400 ml-2">✓ ready</span>}
                </label>
                <textarea
                  value={pasteContent}
                  onChange={e => setPasteContent(e.target.value)}
                  placeholder='{ "name": "My Workflow", "nodes": [...] }'
                  rows={6}
                  className="w-full bg-slate-800 border border-white/8 rounded-xl px-4 py-3 text-white text-xs font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors resize-none"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPaste(true)}
                className="mt-2 text-slate-600 hover:text-slate-400 text-xs underline transition-colors"
              >
                Paste content instead
              </button>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              Workflow Description
              <span className="text-slate-500 font-normal ml-2">optional if file uploaded</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe what the workflow does — triggers, conditions, actions, platforms involved…"
              rows={5}
              className="w-full bg-slate-900 border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 transition-colors resize-none"
            />
          </div>

          {/* File upload */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              Workflow File
              <span className="text-slate-500 font-normal ml-2">optional if description provided</span>
            </label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all select-none ${
                dragOver  ? 'border-indigo-500    bg-indigo-500/5'
                : fileName ? 'border-emerald-500/50 bg-emerald-500/5'
                           : 'border-white/8 hover:border-white/20 bg-slate-900/50'
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".json,.yaml,.yml,.txt,.xml"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) ingestFile(f); }}
              />
              {fileName ? (
                <div>
                  <p className="text-emerald-400 font-medium text-sm">
                    {fileContent ? `✓ ${fileName}` : `⏳ Reading ${fileName}…`}
                  </p>
                  <button type="button" onClick={ev => { ev.stopPropagation(); clearFile(); }}
                    className="text-slate-600 hover:text-slate-400 text-xs mt-1 transition-colors underline">
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <svg className="w-8 h-8 text-slate-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-slate-400 text-sm">Drag & drop or <span className="text-indigo-400 underline">browse</span></p>
                  <p className="text-slate-600 text-xs mt-1">JSON · YAML · XML · TXT (max 10 MB)</p>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating playbook… (30–60s)
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Playbook
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
