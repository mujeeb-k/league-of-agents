// Typed client for every bridge route (docs/ARCHITECTURE.md, API table).
import type {
  Conn,
  ErrorBody,
  EventsResponse,
  FileResponse,
  CommitPreview,
  OkResponse,
  RecordedLine,
  RevertResponse,
  RunDTO,
  SaveBody,
  SaveResponse,
  StartRunBody,
  StateResponse,
} from './types';
import type { AuthorRange } from '../lib/attribution';
import type { SavedLayout } from '../lib/layout';

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
  if (typeof v.code === 'string') out.code = v.code;
  if (isRecord(v.args))
    out.args = Object.fromEntries(
      Object.entries(v.args).filter((e): e is [string, string | number] => ['string', 'number'].includes(typeof e[1])),
    );
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
  exportAttribution: (c: Conn, format: string, files: Record<string, AuthorRange[]>) =>
    request<{ ref: string; commit: string; files: number }>(c, '/api/attribution/export', {
      method: 'POST',
      body: { format, files },
    }),
  authors: (c: Conn, path: string) =>
    request<{ lines: RecordedLine[] }>(c, `/api/authors?path=${encodeURIComponent(path)}`),
  /** Bridges before 0.2.0 answer 404: the app keeps the layout in the browser instead. */
  layout: (c: Conn) => request<{ layout: SavedLayout | null }>(c, '/api/layout'),
  saveLayout: (c: Conn, layout: SavedLayout) =>
    request<OkResponse>(c, '/api/layout', { method: 'POST', body: { layout } }),
  events: (c: Conn, since: number) => request<EventsResponse>(c, `/api/events?since=${since}&delta=1`),
  startRun: (c: Conn, body: StartRunBody) => request<RunDTO>(c, '/api/runs', { method: 'POST', body }),
  cancel: (c: Conn, id: number) => request<OkResponse>(c, `/api/runs/${id}/cancel`, { method: 'POST' }),
  keep: (c: Conn, id: number) => request<OkResponse>(c, `/api/runs/${id}/keep`, { method: 'POST' }),
  commitPreview: (c: Conn, id: number) => request<CommitPreview>(c, `/api/runs/${id}/commit`),
  /** Commits the run's files, and the person's own files they ticked, with their message. */
  commit: (c: Conn, id: number, body: { message: string; include: string[] }) =>
    request<{ sha: string; files: string[] }>(c, `/api/runs/${id}/commit`, { method: 'POST', body }),
  /** Writes back a file as the run's shell command left it, before the bridge put it back. */
  restorePutBack: (c: Conn, id: number, path: string) =>
    request<OkResponse>(c, `/api/runs/${id}/put-back`, { method: 'POST', body: { path } }),
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
  /** A file a run changed, whole, as the run found it. Bridges before 0.2.0 answer 404. */
  runBefore: (c: Conn, id: number, path: string) =>
    request<{ text: string }>(c, `/api/runs/${id}/before?path=${encodeURIComponent(path)}`),
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
