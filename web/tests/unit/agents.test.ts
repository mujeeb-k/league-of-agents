import { describe, expect, it } from 'vitest';
import { modelOf } from '../../src/lib/constants';

describe('modelOf', () => {
  it('shows the model an agent reported, says so for Codex, which reports none, and guesses for no one', () => {
    expect(modelOf('claude', 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(modelOf('codex', null)).toBe('model not reported');
    expect(modelOf('codex-terminal', undefined)).toBe('model not reported');
    expect(modelOf('cursor', null)).toBeNull();
    expect(modelOf('detected', null)).toBeNull();
  });
});
