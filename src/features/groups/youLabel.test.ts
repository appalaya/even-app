import { describe, expect, it } from 'vitest';

import { youLabel } from './youLabel';

describe('the Groups header avatar', () => {
  it('is labelled as the boards label it', () => {
    expect(youLabel('Sam')).toBe('App settings. You: Sam.');
    expect(youLabel(null)).toBe('App settings. No name set yet.');
  });
});
