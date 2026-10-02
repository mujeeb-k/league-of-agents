// Typed client for every bridge route (docs/ARCHITECTURE.md, API table).
import type {
  Conn,
  ErrorBody,
  EventsResponse,
  FileResponse,
  OkResponse,
  RevertResponse,
  RunDTO,
  SaveBody,
  SaveResponse,
  StartRunBody,
  StateResponse,
} from './types';

export class BridgeError extends Error {
  readonly status: number;
  readonly data: ErrorBody;
  constructor(message: string, status: number, data: ErrorBody) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function errorBody(v: unknown): ErrorBody {
  if (!isRecord(v)) return {};
  const out: ErrorBody = {};
  if (typeof v.error === 'string') out.error = v.error;
  if (Array.isArray(v.conflict)) out.conflict = v.conflict.filter((p): p is string => typeof p === 'string');
  if (typeof v.text === 'string') out.text = v.text;
  if (typeof v.hash === 'string') out.hash = v.hash;
  return out;
}

async function request<T>(
  conn: Conn,
  path: string,
  { method = 'GET', body }: { method?: string; body?: object } = {},
): Promise<T> {
  const res = await fetch(conn.base + path, {
    method,
    headers: { authorization: 'Bearer ' + conn.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = errorBody(data);
    throw new BridgeError(e.error || `Bridge error ${res.status}`, res.status, e);
  }
  return data as T;
}

export const bridge = {
  state: (c: Conn) => request<StateResponse>(c, '/api/state'),
  events: (c: Conn, since: number) => request<EventsResponse>(c, `/api/events?since=${since}`),
  startRun: (c: Conn, body: StartRunBody) => request<RunDTO>(c, '/api/runs', { method: 'POST', body }),
  cancel: (c: Conn, id: number) => request<OkResponse>(c, `/api/runs/${id}/cancel`, { method: 'POST' }),
  keep: (c: Conn, id: number) => request<OkResponse>(c, `/api/runs/${id}/keep`, { method: 'POST' }),
  /** Turns on checks the bridge found, by name. */
  enableChecks: (c: Conn, names: string[], share: boolean) =>
    request<{ checks: { name: string; run: string }[] }>(c, '/api/checks', {
      method: 'POST',
      body: { names, share },
    }),
  /** Turns off one configured check, by name. */
  turnOffCheck: (c: Conn, name: string) =>
    request<OkResponse>(c, '/api/checks/off', { method: 'POST', body: { name } }),
  file: (c: Conn, path: string) => request<FileResponse>(c, `/api/file?path=${encodeURIComponent(path)}`),
  /** A file changed on disk since it was opened comes back as `{ changed }` instead of throwing. */
  async save(c: Conn, body: SaveBody): Promise<SaveResponse | { changed: { text: string; hash: string } }> {
    try {
      return await request<SaveResponse>(c, '/api/save', { method: 'POST', body });
    } catch (e) {
      if (e instanceof BridgeError && e.status === 409 && e.data.error === 'changed')
        return { changed: { text: e.data.text ?? '', hash: e.data.hash ?? '' } };
      throw e;
    }
  },
  /** A 409 comes back as `{ conflict }` instead of throwing. */
  async revert(c: Conn, id: number, force: boolean): Promise<RevertResponse> {
    try {
      return await request<RevertResponse>(c, `/api/runs/${id}/revert`, {
        method: 'POST',
        body: force ? { force: true } : {},
      });
    } catch (e) {
      if (e instanceof BridgeError && e.status === 409) return { conflict: e.data.conflict ?? [] };
      throw e;
    }
  },
};
