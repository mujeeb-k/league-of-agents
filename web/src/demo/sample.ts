// Neutral demo repository. A fictional webhook delivery service.
// Its shape:
// 23 files, 8 empty folders, one 12-file folder, and three runs covering
// single-line edits, multi-hunk inserts, a created file, and a pure deletion.
// The file contents live in sample.txt in the "@@ path" format.
import type { SampleRunDef, TreeSpec } from '../lib/types';

export const SAMPLE_REPO = 'relay';
export const SAMPLE_BRANCH = 'main';
/** Agents offered in demo mode. Only agents the bridge can run. */
export const DEMO_AGENTS = ['claude', 'cursor', 'codex'];

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
    title: 'Back off retries after a failed delivery',
    scope: ['server/delivery/'],
    when: '2 min ago',
    dur: '2m 05s',
    prompt: 'Failed deliveries retry right away and hammer the endpoint. Back off exponentially with jitter.',
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
];
