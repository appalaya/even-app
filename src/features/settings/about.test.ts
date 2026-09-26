import { describe, expect, it } from 'vitest';

import { versionLabel } from './about';

describe('about', () => {
  it('writes the version as the board does', () => {
    expect(versionLabel('1.0.0', '1')).toBe('1.0 (1)');
    expect(versionLabel('1.2.3', '45')).toBe('1.2.3 (45)');
    expect(versionLabel(null, null)).toBe('1.0 (1)');
  });
});
