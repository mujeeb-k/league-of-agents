// Neutral demo repository. A fictional webhook delivery service.
// Its shape:
// 23 files, 8 empty folders, one 12-file folder, and three runs covering
// single-line edits, multi-hunk inserts, a created file, and a pure deletion,
// then three sessions still at work as the demo opens, each on a section of its own.
// The file contents live in sample.txt in the "@@ path" format.
import type { SampleRunDef, TreeSpec } from '../lib/types';

export const SAMPLE_REPO = 'relay';
export const SAMPLE_BRANCH = 'main';
/** Agents offered in demo mode. Only agents the bridge can run. */
export const DEMO_AGENTS = ['claude', 'cursor', 'codex'];
/** The agents the demo shows kept inside their selection, as macOS's sandbox keeps them (bridge/lib/sandbox.mjs). */
export const DEMO_STAYS = ['claude', 'hermes'];

const D = (n: string, note: string, c: (string | TreeSpec)[]): TreeSpec => ({ n, note, c });

export const SAMPLE_TREE: TreeSpec = D('relay', '', [
  D('server', '', [
    D('api', '', [D('console', 'operator UI', []), D('routes', '', ['subscriptions.ts', 'endpoints.ts'])]),
    D('delivery', 'webhook dispatch and retry', [
      D('retry', 'newer retry scheduler', ['schedule-retry.ts', 'backoff.ts']),
      D('signing-keys', '', []),
      D('pipeline', '', ['dispatch.ts', 'build-payload.ts', 'sign-request.ts', 'send-request.ts', 'record-attempt.ts']),
      D('model', '', ['types.ts']),
      'endpoint-registry.ts',
      'endpoint-health.ts',
      'http-client.ts',
      'rate-limit.ts',
      'verify-signature.ts',
      'event-store.ts',
      'attempt-log.ts',
      'payload-schema.ts',
      'dead-letter.ts',
      'circuit-breaker.ts',
      'tenant-config.ts',
      'secrets.ts',
    ]),
    D('storage', '', [
      D('migrations', 'SQL schema migrations', []),
      D('queues', '', []),
      D('tenants', 'per-tenant settings', []),
    ]),
  ]),
  D('ops', '', [D('runbooks', 'on-call runbooks', [])]),
  D('.github', 'CI workflows', []),
  D('_archive', 'v1 queue implementation', []),
  'relay.config.ts',
]);

export const SAMPLE_RUNS: SampleRunDef[] = [
  {
    id: 12,
    agent: 'codex',
    title: 'Compare webhook signatures in constant time',
    scope: ['server/delivery/verify-signature.ts', 'server/api/routes/'],
    when: 'Yesterday',
    dur: '1m 12s',
    prompt: 'Signature checks compare strings with ===. Use a constant-time comparison.',
    summary:
      '`verify-signature.ts` now compares digests with `timingSafeEqual` after checking their lengths. The subscribe route trims the signature header first.',
    ch: {
      'server/delivery/verify-signature.ts': [
        [
          6,
          1,
          [
            '  return expected.some((mac) => mac.length === v1?.length && timingSafeEqual(Buffer.from(mac), Buffer.from(v1)));',
          ],
        ],
      ],
      'server/api/routes/subscriptions.ts': [
        [5, 1, ["  const signature = (req.headers.get('x-relay-signature') ?? '').trim();"]],
      ],
    },
  },
  {
    id: 13,
    agent: 'cursor',
    title: 'Move rate limit lookup into its own function',
    scope: ['server/delivery/'],
    when: '1 hour ago',
    dur: '3m 40s',
    prompt:
      'Rate limits are merged inline in allow(). Pull the lookup into a function and derive burst from the per-second rate.',
    summary:
      'Added `limitFor` with per-tenant overrides and a burst of at least twice the rate. The circuit breaker now stays closed for tenants with rate limiting turned off.',
    ch: {
      'server/delivery/rate-limit.ts': [
        [8, 1, ['  const limit = limitFor(tenant);']],
        [
          14,
          0,
          [
            '',
            'export function limitFor(tenant: string): RateLimit {',
            '  const override = tenantById(tenant)?.limits ?? {};',
            '  const perSecond = override.perSecond ?? DEFAULT.perSecond;',
            '  const burst = override.burst ?? Math.max(DEFAULT.burst, perSecond * 2);',
            '  return { perSecond, burst };',
            '}',
          ],
        ],
      ],
      'server/delivery/circuit-breaker.ts': [
        [
          8,
          1,
          ['  if (healthOf(endpointId).failures < 5 || tenantById(endpointId)?.limits?.perSecond === 0) return false;'],
        ],
      ],
    },
  },
  {
    id: 14,
    agent: 'claude',
    model: 'claude-sonnet-5-5',
    toolWritten: true,
    title: 'Back off retries after a failed delivery',
    scope: ['server/delivery/'],
    when: '2 min ago',
    dur: '2m 05s',
    prompt: 'Failed deliveries keep hammering the endpoint. Fix the retries without breaking the rest of delivery.',
    summary:
      '`scheduleRetry` now waits for an exponential backoff with jitter before each attempt.\n\n- **New:** `retry/backoff.ts` computes the delay.\n- **Moved:** the retry decision is now `shouldRetry` in `endpoint-health.ts`.\n- **Removed:** an unused import from `dead-letter.ts`.',
    ch: {
      'server/delivery/retry/schedule-retry.ts': [
        [3, 0, ["import { backoffDelay } from './backoff';", "import { shouldRetry } from '../endpoint-health';"]],
        [
          8,
          0,
          [
            "  if (!shouldRetry(attempt)) return deadLetter(attempt, 'endpoint unhealthy');",
            '  const delay = backoffDelay(attempt.number);',
            '  attempt.event.notBefore = Date.now() + delay;',
          ],
        ],
      ],
      'server/delivery/retry/backoff.ts': 'CREATE',
      'server/delivery/endpoint-health.ts': [
        [11, 1, ['export const isHealthy = (id: string) => !tooManyFailures(healthOf(id));']],
        [
          12,
          0,
          [
            '',
            'export function shouldRetry(a: Attempt) {',
            '  return a.number < 8 && !tooManyFailures(healthOf(a.event.endpoint.id));',
            '}',
            '',
            'const tooManyFailures = (h: Health) => h.failures >= FAILURE_LIMIT;',
          ],
        ],
      ],
      'server/delivery/dead-letter.ts': [
        [1, 1, []],
        [8, 1, ['    reason,', '    attempts: attempt.number,']],
      ],
    },
  },
  {
    id: 15,
    agent: 'claude',
    model: 'claude-sonnet-5-5',
    toolWritten: true,
    title: "Sign each webhook with its endpoint's own secret",
    scope: ['server/delivery/pipeline/'],
    when: 'Just now',
    dur: '1m 12s',
    prompt: "Each endpoint has its own secret, but every webhook is signed with the shared key. Use the endpoint's.",
    summary:
      "`signRequest` now takes the secret to sign with, and the dispatcher passes the endpoint's own.\n\n- **Changed:** `sign-request.ts` no longer reads the shared key from `secrets.ts`.\n- **Changed:** `dispatch.ts` signs with `event.endpoint.secret`.",
    working: {
      after: 8000,
      steps: [
        'Read server/delivery/pipeline/sign-request.ts',
        'Read server/delivery/model/types.ts',
        'Read server/delivery/pipeline/dispatch.ts',
        'Edit server/delivery/pipeline/sign-request.ts',
        'Edit server/delivery/pipeline/dispatch.ts',
      ],
    },
    ch: {
      'server/delivery/pipeline/sign-request.ts': [
        [1, 1, []],
        [3, 1, ['export function signRequest(body: string, secret: string) {']],
        [5, 1, ["  const mac = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');"]],
      ],
      'server/delivery/pipeline/dispatch.ts': [
        [9, 1, ['    const res = await sendRequest(event.endpoint, signRequest(payload, event.endpoint.secret));']],
      ],
    },
  },
  {
    id: 16,
    agent: 'codex',
    title: 'Say when a delivery timed out',
    scope: ['server/delivery/http-client.ts'],
    when: 'Just now',
    dur: '41s',
    prompt: "A slow endpoint's timeout looks like any other network error. Say when a request timed out.",
    summary:
      '`httpClient.post` says when a request **timed out**, and after how long, apart from other network errors.',
    working: {
      after: 13000,
      steps: [
        'Read server/delivery/http-client.ts',
        'Read server/delivery/pipeline/send-request.ts',
        'Edit server/delivery/http-client.ts',
      ],
    },
    ch: {
      'server/delivery/http-client.ts': [
        [
          8,
          0,
          [
            '      if (ctrl.signal.aborted) return { status: 0, error: `timed out after ${opts.timeoutMs} ms`, timedOut: true };',
          ],
        ],
      ],
    },
  },
  {
    id: 17,
    agent: 'cursor',
    title: "Cap each tenant's retries at 12",
    scope: ['server/delivery/tenant-config.ts'],
    when: 'Just now',
    dur: '58s',
    prompt: "Some tenants set hundreds of retry attempts. Cap them at 12, whatever a tenant's settings say.",
    summary: "Retries are capped at **12** attempts per tenant, even when a tenant's settings ask for more.",
    working: {
      after: 17000,
      steps: [
        'Read server/delivery/tenant-config.ts',
        'Read server/delivery/model/types.ts',
        'Edit server/delivery/tenant-config.ts',
      ],
    },
    ch: {
      'server/delivery/tenant-config.ts': [
        [4, 0, ['const MAX_ATTEMPTS = 12;', '']],
        [
          10,
          1,
          [
            '  const policy = { maxAttempts: 8, multiplier: 1, ...t?.retry };',
            '  return { ...policy, maxAttempts: Math.min(policy.maxAttempts, MAX_ATTEMPTS) };',
          ],
        ],
      ],
    },
  },
];
