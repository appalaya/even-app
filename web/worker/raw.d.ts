/**
 * Vite's `?raw` imports and `import.meta.glob`, which config.test.ts uses to read the files it checks, so no test
 * needs Node's types (with them, the script could use Node globals that the Workers runtime does not have).
 */
declare module '*?raw' {
  const text: string;
  export default text;
}

interface ImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
