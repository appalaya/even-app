/// <reference types="node" />
/**
 * The app's entry (index.js). A headless start (Android's WorkManager waking a killed process for the background
 * task) evaluates it but never src/app/_layout.tsx, so the task is defined from here: after the CSPRNG and the
 * foreground check its yields read, before Expo Router. With Expo Router's entry as "main", the task was never
 * defined there and the run did nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

describe('the app entry', () => {
  it('is index.js', () => {
    expect((JSON.parse(read('package.json')) as { main?: string }).main).toBe('index.js');
  });

  it('imports the CSPRNG, the foreground check, the background task, then Expo Router, and nothing else', () => {
    const imports = [...read('index.js').matchAll(/^import\s+'([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual([
      './src/polyfills',
      './src/services/appForeground',
      './src/services/background/task',
      'expo-router/entry',
    ]);
  });
});
