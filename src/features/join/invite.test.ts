import { describe, expect, it } from 'vitest';

import { hostOf, moveQuestion, payloadFromUrl, problemMessage, recoverQuestion } from './invite';

describe('join invite helpers', () => {
  it('takes the payload from an invite link', () => {
    expect(payloadFromUrl('https://even.appalaya.com/i#eyJ2IjoxfQ')).toBe('eyJ2IjoxfQ');
    expect(payloadFromUrl('https://even.appalaya.com/i/#xyz')).toBe('xyz');
    expect(payloadFromUrl('https://even.appalaya.com/i')).toBeNull();
    expect(payloadFromUrl('https://even.appalaya.com/i#')).toBeNull();
    expect(payloadFromUrl(null)).toBeNull();
  });

  it('words the checksum problem as the board does', () => {
    expect(problemMessage('checksum')).toBe("That code isn't complete. Copy it again.");
  });

  it('words the move and recovery confirmations', () => {
    expect(hostOf('https://sync.even.appalaya.com')).toBe('sync.even.appalaya.com');
    expect(
      moveQuestion('Banff 2026', 'https://sync.even.appalaya.com', 'https://sync.example.net'),
    ).toBe('Move Banff 2026 from sync.even.appalaya.com to sync.example.net?');
    expect(recoverQuestion(2)).toBe('Recover 2 groups from your keychain?');
    expect(recoverQuestion(1)).toBe('Recover 1 group from your keychain?');
  });
});
