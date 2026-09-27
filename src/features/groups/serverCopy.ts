/**
 * The server-address sentences of the error-copy panel (Groups, create and join, extra states), shared by Create
 * group's sync server field and Group settings' Move server. Shown under the field in the field-error style.
 */
import { canonicalOrigin } from '@even/core';

import type { ServerCheck } from '@/state';

export type ServerProblem = Extract<ServerCheck, { ok: false }>['problem'];

export function serverProblemMessage(problem: ServerProblem): string {
  switch (problem) {
    case 'invalid_url':
      return "That isn't a server address. It should start with https://";
    case 'not_an_even_server':
      return "That URL isn't an Even server. Check the address.";
    case 'unreachable':
      return "Couldn't reach that server. Check the address or try again.";
  }
}

/** Checked as you leave the field: an address that is not an https URL gets the first sentence. */
export function serverAddressProblem(text: string): ServerProblem | null {
  if (text.trim() === '') return null;
  try {
    canonicalOrigin(text.trim());
    return null;
  } catch {
    return 'invalid_url';
  }
}
