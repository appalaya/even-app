/**
 * Dev only: the native-crypto harness (`even://dev/crypto`; src/dev/cryptoHarness.ts says what it runs). Parameters:
 * `cases` (random cross-check cases, default 3000), `seed`, `sizes` (comma-separated group sizes to time, default
 * 3400,10000; `none` skips the timings), `runs` (cold derives per size, default 2), `timings=only` (skip the
 * conformance part). Each result is a line here and in the log; the whole report is
 * `globalThis.__evenCryptoHarness` for the Metro debugger. Production builds redirect home.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText, Screen } from '@/components';
import { runCryptoHarness } from '@/dev/cryptoHarness';
import { layout } from '@/theme';

export default function CryptoRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Harness />;
}

function Harness() {
  const params = useLocalSearchParams<{
    cases?: string;
    seed?: string;
    sizes?: string;
    runs?: string;
    timings?: string;
  }>();
  const [lines, setLines] = useState<string[]>([`Crypto harness on ${Platform.OS}…`]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const sizes =
      params.sizes === undefined
        ? undefined
        : params.sizes === 'none'
          ? []
          : params.sizes.split(',').map(Number).filter(Number.isFinite);
    void runCryptoHarness({
      ...(params.cases === undefined ? {} : { cases: Number(params.cases) }),
      ...(params.seed === undefined ? {} : { seed: Number(params.seed) }),
      ...(sizes === undefined ? {} : { sizes }),
      ...(params.runs === undefined ? {} : { runs: Number(params.runs) }),
      timingsOnly: params.timings === 'only',
      onLine: (line) => setLines((current) => [...current, line]),
    }).catch((error: unknown) => {
      setLines((current) => [
        ...current,
        `Harness failed: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    });
  }, [params]);

  return (
    <Screen largeTitle="Crypto">
      <View style={styles.lines}>
        {lines.map((line, i) => (
          <AppText key={i} variant="footnote" color="textSecondary">
            {line}
          </AppText>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lines: { paddingHorizontal: layout.textInset, gap: 6 },
});
