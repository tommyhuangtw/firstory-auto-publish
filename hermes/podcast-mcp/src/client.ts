const BASE_URL = process.env.PODCAST_API_URL || 'http://localhost:3000';

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  timeout?: number;
}

async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { method = 'GET', body, params, timeout = 30000 } = options;

  let url = `${BASE_URL}${path}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg = typeof data === 'object' && data !== null && 'error' in data
        ? (data as { error: string }).error
        : `HTTP ${res.status}: ${text.slice(0, 200)}`;
      throw new Error(msg);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const client = {
  get(path: string, params?: Record<string, string | number | undefined>) {
    return request(path, { params });
  },
  post(path: string, body?: unknown) {
    return request(path, { method: 'POST', body });
  },
  put(path: string, body?: unknown) {
    return request(path, { method: 'PUT', body });
  },
  patch(path: string, body?: unknown) {
    return request(path, { method: 'PATCH', body });
  },
  delete(path: string, params?: Record<string, string | number | undefined>) {
    return request(path, { method: 'DELETE', params });
  },
};
