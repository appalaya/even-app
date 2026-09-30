import { describe, expect, it } from 'vitest';

import { diagnosticsSections } from '@/features/diagnostics/format';

import { diagnosticsCaption, versionLabel } from './about';

describe('about', () => {
  it('writes the version as the board does', () => {
    expect(versionLabel('1.0.0', '1')).toBe('1.0 (1)');
    expect(versionLabel('1.2.3', '45')).toBe('1.2.3 (45)');
    expect(versionLabel(null, null)).toBe('1.0 (1)');
  });

  it("captions the Diagnostics row with what that platform's page shows", () => {
    expect(diagnosticsCaption('ios')).toBe(
      'What the app knows about its model and sync. Nothing here leaves your phone.',
    );
    expect(diagnosticsCaption('android')).toBe(
      'What the app knows about sync. Nothing here leaves your phone.',
    );
  });

  it('names the model only where Diagnostics has the model sections', () => {
    for (const os of ['ios', 'android']) {
      expect(diagnosticsCaption(os).includes('model')).toBe(
        diagnosticsSections(os, 1).includes('model'),
      );
    }
  });
});
