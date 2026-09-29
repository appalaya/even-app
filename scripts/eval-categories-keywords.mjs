// Adds what packages/core knows to each labelled title in packages/core/src/categories.eval.json, for
// scripts/eval-categories.swift (which has no TypeScript of its own). Node runs packages/core's TypeScript directly
// (type stripping); the hook below resolves core's "./x.js" import specifiers to the "./x.ts" files on disk.
//
//   node scripts/eval-categories-keywords.mjs [eval file] > cases.json
//
// Output: { "cases": [{ "title", "category", "split", "keyword", "history", "historyMatch", "words", "matches" }],
//           "refusals": [{ "title", "category", "kind", "keyword", "words", "matches", "labelled" }] }:
// - `keyword`: `inferCategory(title)` ("other" when no keyword matches);
// - `words`: how many words the table reads in the title (`titleWords`); `matches`: the table's keywords found in
//   it, each as `[keyword, category]`, leaving out one that sits inside a longer match ("bus" in "bus ticket"). The
//   gate variants in scripts/eval-categories.swift read these;
// - `history`: `recallCategory(title)` as if every other title in the file had been saved earlier in the same group
//   with its label (leave one out), or null; `historyMatch` is "same" or "similar". This measures how often the set's
//   own repeats and near-repeats would be caught, and how often rightly; how often a real group repeats a title is a
//   property of the group, not of this file;
// - `refusals`: packages/core/src/categories.refusals.json, the titles guardrails might refuse, for `--refusals`;
//   `labelled` is true when the title is also in the eval set (its label comes from there).
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

const { inferCategory, keywordMatches, titleWords } = await import('../packages/core/src/categories.ts');
const { recallCategory, rememberCategories } = await import('../packages/core/src/categoryHistory.ts');

const path = process.argv[2] ?? new URL('../packages/core/src/categories.eval.json', import.meta.url);
const refusalsPath = new URL('../packages/core/src/categories.refusals.json', import.meta.url);
const { cases } = JSON.parse(readFileSync(path, 'utf8'));
const { titles } = JSON.parse(readFileSync(refusalsPath, 'utf8'));

const evidence = (title) => ({
  words: titleWords(title).length,
  matches: keywordMatches(title).map((m) => [m.keyword, m.category]),
});

const out = cases.map((c, i) => {
  const others = cases.filter((_, j) => j !== i).map((o, j) => ({ ...o, at: j }));
  const recalled = recallCategory(c.title, [rememberCategories(others)]);
  return {
    ...c,
    keyword: inferCategory(c.title),
    history: recalled?.category ?? null,
    historyMatch: recalled?.match ?? null,
    ...evidence(c.title),
  };
});
const inEval = new Set(cases.map((c) => c.title));
const refusals = titles.map((t) => ({
  ...t,
  keyword: inferCategory(t.title),
  ...evidence(t.title),
  labelled: inEval.has(t.title),
}));
process.stdout.write(JSON.stringify({ cases: out, refusals }, null, 1) + '\n');
