export interface User {
  id: string;
  email: string;
  name: string | null;
  gdrive_folder_id: string | null;
  gdrive_folder_url: string | null;
  created_at: string;
}

export interface RunSummary {
  id: string;
  source: string | null;
  destination: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  original_filename: string | null;
  gdrive_run_folder_url: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Run extends RunSummary {
  user_id: string;
  description: string | null;
  playbook_text: string | null;
  import_file_name: string | null;
  import_file_extension: string | null;
  import_file_content: string | null;
  has_import_file: boolean;
}

export interface AuthState {
  userId: string;
  apiKey: string;
  email: string;
  name: string | null;
}

export const PLATFORMS = ['n8n', 'Make', 'Zapier', 'Tray', 'Boomi', 'Workato', 'Celigo', 'Power Automate'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_COLORS: Record<Platform, { bg: string; text: string; dot: string }> = {
  n8n:     { bg: 'bg-orange-500/10', text: 'text-orange-400',  dot: 'bg-orange-400'  },
  Make:    { bg: 'bg-violet-500/10', text: 'text-violet-400',  dot: 'bg-violet-400'  },
  Zapier:  { bg: 'bg-amber-500/10',  text: 'text-amber-400',   dot: 'bg-amber-500'   },
  Tray:    { bg: 'bg-sky-500/10',    text: 'text-sky-400',     dot: 'bg-sky-400'     },
  Boomi:   { bg: 'bg-emerald-500/10',text: 'text-emerald-400', dot: 'bg-emerald-400' },
  Workato: { bg: 'bg-blue-500/10',   text: 'text-blue-400',    dot: 'bg-blue-400'    },
  Celigo:  { bg: 'bg-red-500/10',    text: 'text-red-400',     dot: 'bg-red-400'     },
  'Power Automate': { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
};
