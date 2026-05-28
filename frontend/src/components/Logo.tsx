interface LogoProps {
  /** 'sm' = nav bar (w-7); 'md' = auth/recover pages (w-9). Default: 'md' */
  size?: 'sm' | 'md';
}

export function Logo({ size = 'md' }: LogoProps) {
  const ring  = size === 'sm' ? 'w-7 h-7 rounded-lg'   : 'w-9 h-9 rounded-xl shadow-lg shadow-indigo-500/30';
  const icon  = size === 'sm' ? 'w-4 h-4'              : 'w-5 h-5';
  const text  = size === 'sm' ? 'font-bold text-white text-sm tracking-tight' : 'text-xl font-bold text-white tracking-tight';

  return (
    <div className="flex items-center gap-2.5">
      <div className={`${ring} bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center`}>
        <svg className={`${icon} text-white`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <span className={text}>FlowShift</span>
    </div>
  );
}
