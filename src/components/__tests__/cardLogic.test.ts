import { Children, createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { separatedRowKey } from '../cardLogic';

const rows = (ids: string[]) =>
  Children.toArray(ids.map((id) => createElement('row', { key: id })));
const keysOf = (ids: string[]) => rows(ids).map((child, i) => separatedRowKey(child, i));

describe("a separated Card's row keys", () => {
  it("are the rows' own keys, so a row added at the top leaves every other row's key as it was", () => {
    const before = keysOf(['b', 'c', 'd']);
    const after = keysOf(['a', 'b', 'c', 'd']);
    expect(after.slice(1)).toEqual(before);
    expect(new Set(after).size).toBe(4);
  });

  it('fall back to the position for children without a key (text)', () => {
    const items = Children.toArray(['one', 'two']);
    expect(items.map((child, i) => separatedRowKey(child, i))).toEqual([0, 1]);
  });
});
