import type { User, Run, RunSummary } from './types';

function getApiKey(): string {
  try {
    const auth = JSON.parse(localStorage.getItem('flowshift_auth') || '{}');
    return auth.apiKey || '';
  } catch {
    return '';
  }
}

const API = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const apiKey = getApiKey();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  register: (email: string, name?: string) =>
    request<User & { api_key: string }>('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    }),

  getMe: () => request<User>('/users/me'),

  getRuns: (userId: string) =>
    request<{ runs: RunSummary[] }>(`/users/${userId}/runs`),

  createRun: (data: { source: string; destination: string; description?: string; file?: File }) => {
    const form = new FormData();
    form.append('source', data.source);
    form.append('destination', data.destination);
    if (data.description) form.append('description', data.description);
    if (data.file) form.append('file', data.file);
    return request<Run>('/runs', { method: 'POST', body: form });
  },

  getRun: (id: string) => request<Run>(`/runs/${id}`),
};
