// A session that ends without finishing keeps its section on the map, marked ended. Which sessions those are is
// read from each run's own status as the bridge sends it, never from the list of sessions at work: that list and
// the run's status can arrive in either order.
import { beforeEach, describe, expect, it } from 'vitest';
import { ended, forgetSessions, noteEnded, seen } from '../../src/state/sessions';
import type { Run } from '../../src/lib/types';

const at = (id: number, status: Run['status'], limited = false) => ({ id, status, limited });

describe('ended sessions', () => {
  beforeEach(forgetSessions);

  it('marks a run seen at work that is now stopped, failed, interrupted or rate limited', () => {
    noteEnded([at(1, 'running'), at(2, 'running'), at(3, 'running'), at(4, 'running'), at(5, 'running')]);
    noteEnded([at(1, 'cancelled'), at(2, 'failed'), at(3, 'interrupted'), at(4, 'done', true), at(5, 'done')]);
    expect([...ended].sort()).toEqual([1, 2, 3, 4]);
  });

  it('marks it whichever state says so, the one it ended in or a later one', () => {
    noteEnded([at(1, 'running')]);
    noteEnded([at(1, 'running')]);
    noteEnded([at(1, 'cancelled')]);
    noteEnded([at(1, 'cancelled')]);
    expect([...ended]).toEqual([1]);
  });

  it('leaves alone runs that had ended before the app saw them at work', () => {
    noteEnded([at(1, 'cancelled'), at(2, 'failed')]);
    expect([...ended]).toEqual([]);
  });

  it('never brings a mark back once the run was looked at', () => {
    noteEnded([at(1, 'running')]);
    noteEnded([at(1, 'cancelled')]);
    seen(1);
    noteEnded([at(1, 'cancelled')]);
    expect([...ended]).toEqual([]);
  });
});
