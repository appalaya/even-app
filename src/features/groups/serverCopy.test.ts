import { describe, expect, it } from 'vitest';

import { serverAddressProblem, serverProblemMessage } from './serverCopy';

describe('server address copy', () => {
  it('words the three problems as the error-copy panel does', () => {
    expect(serverProblemMessage('invalid_url')).toBe(
      "That isn't a server address. It should start with https://",
    );
    expect(serverProblemMessage('not_an_even_server')).toBe(
      "That URL isn't an Even server. Check the address.",
    );
    expect(serverProblemMessage('unreachable')).toBe(
      "Couldn't reach that server. Check the address or try again.",
    );
  });

  it('flags a non-https address as you leave the field', () => {
    expect(serverAddressProblem('https://home.example.net')).toBeNull();
    expect(serverAddressProblem('home.example.net')).toBe('invalid_url');
    expect(serverAddressProblem('http://home.example.net')).toBe('invalid_url');
    expect(serverAddressProblem('  ')).toBeNull();
  });
});
