// Default to same-origin /api now that the Next.js backend runs in the same
// project. NEXT_PUBLIC_API_URL overrides this (e.g. when a preview frontend
// needs to point at a different backend).
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

let tokenGetter: (() => Promise<string>) | null = null;

export function setTokenGetter(fn: () => Promise<string>) {
  tokenGetter = fn;
}

export class ApiError extends Error {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(status: number, statusText: string, body: any, bodyText?: string) {
    const bodyMsg =
      (body && typeof body === 'object' && typeof body.message === 'string' && body.message) ||
      (body && typeof body === 'object' && typeof body.error === 'string' && body.error) ||
      (typeof bodyText === 'string' && bodyText.trim()) ||
      '';
    const parts = [String(status), statusText, bodyMsg].filter(Boolean);
    super(parts.join(' — '));
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  };

  if (tokenGetter) {
    const token = await tokenGetter();
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let body: unknown = null;
    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
      if (bodyText) {
        try { body = JSON.parse(bodyText); } catch { /* not JSON, keep text */ }
      }
    } catch { /* ignore */ }
    throw new ApiError(res.status, res.statusText, body, bodyText);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
