import { InviteError } from '@even/core';
import { describe, expect, it } from 'vitest';

import { StoreError } from '../services/storage/errors';
import { SyncError } from '../services/sync/errors';
import { describeForLog, StateError } from './errors';

describe('describeForLog (review L7)', () => {
  const localId = 'A'.repeat(43);

  it('names the error and its code, never its message', () => {
    expect(describeForLog(new StoreError('group_not_found', `no group ${localId}`))).toBe(
      'StoreError code=group_not_found',
    );
    expect(describeForLog(new StateError('invalid', `the title ${localId} is too long`))).toBe(
      'StateError code=invalid',
    );
    expect(
      describeForLog(new SyncError('network', 'GET https://sync.example.com/v1/groups/x: down')),
    ).toBe('SyncError code=network');
    expect(describeForLog(new InviteError('checksum', 'Banff 2026'))).toBe('Error code=checksum');
    expect(describeForLog(new TypeError(`cannot read ${localId}`))).toBe('TypeError');
  });

  it('keeps anything that is not a plain name or code out', () => {
    const odd = new Error('message');
    odd.name = `Error from https://evil.example ${localId}`;
    (odd as Error & { code: string }).code = `group ${localId}`;
    expect(describeForLog(odd)).toBe('Error');
    expect(describeForLog(`no group ${localId}`)).toBe('string');
    expect(describeForLog({ message: localId })).toBe('object');
    expect(describeForLog(undefined)).toBe('undefined');
  });
});
