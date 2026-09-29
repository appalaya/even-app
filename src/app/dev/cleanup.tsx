/**
 * Dev only, once per phone: deletes the production copies of the groups that seeds made before they moved to the
 * dev server (`even://dev/cleanup`; src/dev/cleanupProduction.ts says what it reaches). The seed refuses to run
 * while this phone still holds a group on production and points here. Each line names the production group id the
 * DELETE was for. Production builds redirect home.
 */
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Screen } from '@/components';
import { cleanupProduction } from '@/dev/cleanupProduction';
import { useApp } from '@/state';
import { layout } from '@/theme';

export default function CleanupRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Cleanup />;
}

function Cleanup() {
  const services = useApp();
  const [lines, setLines] = useState<string[]>([
    'Deleting the production copies older seeds made…',
  ]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const log = (line: string) => setLines((current) => [...current, line]);
    void (async () => {
      const done = await cleanupProduction(services);
      for (const line of done) {
        log(
          `${line.outcome}${line.error === undefined ? '' : ` (${line.error})`} · ${line.label} · ${line.groupId}`,
        );
      }
      const count = (outcome: string) => done.filter((line) => line.outcome === outcome).length;
      const summary = `Done: ${count('deleted')} deleted, ${count('pending')} pending (retried on the next sync), ${count('failed')} failed.`;
      console.log(`[cleanup] ${summary}`);
      log(summary);
    })().catch((error: unknown) => {
      log(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [services]);

  return (
    <Screen largeTitle="Cleanup">
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
