// Adds what packages/core knows to each labelled title in packages/core/src/categories.eval.json, for
// scripts/eval-categories.swift (which has no TypeScript of its own). Node runs packages/core's TypeScript directly
// (type stripping); the hook below resolves core's "./x.js" import specifiers to the "./x.ts" files on disk.
//
//   node scripts/eval-categories-keywords.mjs [eval file] > cases.json
//
// Output: { "cases": [{ "title", "category", "split", "keyword", "history", "historyMatch" }] }:
// - `keyword`: `inferCategory(title)` ("other" when no keyword matches);
// - `history`: `recallCategory(title)` as if every other title in the file had been saved earlier in the same group
//   with its label (leave one out), or null; `historyMatch` is "same" or "similar". This measures how often the set's
//   own repeats and near-repeats would be caught, and how often rightly; how often a real group repeats a title is a
//   property of the group, not of this file.
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const ts = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(ts))) return nextResolve(ts.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { inferCategory } = await import('../packages/core/src/categories.ts');
const { recallCategory, rememberCategories } = await import('../packages/core/src/categoryHistory.ts');

const path = process.argv[2] ?? new URL('../packages/core/src/categories.eval.json', import.meta.url);
const { cases } = JSON.parse(readFileSync(path, 'utf8'));
const out = cases.map((c, i) => {
  const others = cases.filter((_, j) => j !== i).map((o, j) => ({ ...o, at: j }));
  const recalled = recallCategory(c.title, [rememberCategories(others)]);
  return {
    ...c,
    keyword: inferCategory(c.title),
    history: recalled?.category ?? null,
    historyMatch: recalled?.match ?? null,
  };
});
process.stdout.write(JSON.stringify({ cases: out }, null, 1) + '\n');
