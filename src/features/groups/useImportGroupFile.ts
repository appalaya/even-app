/**
 * "Import group file" (Groups and App settings): pick a `.even` file, import it through the GroupService, and open
 * the group. What can go wrong reads as the error-copy panel words it (Groups, create and join, extra states):
 * - not a group file (or a newer one): an alert, "That isn't an Even group file." / "This invite needs a newer Even.";
 * - damaged (the invite's checksum fails, or it is malformed): an alert, "That group file is damaged. Export it
 *   again.";
 * - the group's invite was regenerated since (the group is closed or hidden here): a sheet, "This file is from
 *   before Banff 2026's invite was regenerated. Ask a member for the new one." with Cancel, or "Open old copy
 *   anyway" (a read-only copy that never syncs).
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { useApp } from '@/state';

import { hrefs } from './routes';

export interface RefusedImport {
  text: string;
  localId: string;
  name: string;
}

/** The sentence for a file whose group was rotated away here. */
export function regeneratedMessage(name: string): string {
  return `This file is from before ${name}'s invite was regenerated. Ask a member for the new one.`;
}

export function useImportGroupFile() {
  const { groups, store } = useApp();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<RefusedImport | null>(null);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await groups.pickGroupFile();
      if (text === null) return;
      const result = await groups.importGroupFile(text);
      switch (result.outcome) {
        case 'imported':
          router.push(hrefs.group(result.localId));
          return;
        case 'refused': {
          const row = await store.getGroup(result.localId);
          const name = row?.nameCache?.trim() ? row.nameCache : 'this group';
          setRefused({ text, localId: result.localId, name });
          return;
        }
        case 'invalid':
          Alert.alert(
            result.problem === 'format'
              ? "That isn't an Even group file."
              : result.problem === 'version'
                ? 'This invite needs a newer Even.'
                : 'That group file is damaged. Export it again.',
          );
          return;
      }
    } catch (error) {
      console.warn('import group file failed', error instanceof Error ? error.message : error);
      Alert.alert("That isn't an Even group file.");
    } finally {
      setBusy(false);
    }
  }, [busy, groups, store]);

  /** "Open old copy anyway": import it as the read-only copy it is (it never syncs). */
  const openAnyway = useCallback(async () => {
    if (refused === null) return;
    setBusy(true);
    try {
      const result = await groups.importGroupFile(refused.text, { force: true });
      setRefused(null);
      if (result.outcome === 'imported') router.push(hrefs.group(result.localId));
    } catch (error) {
      console.warn('import group file failed', error instanceof Error ? error.message : error);
      setRefused(null);
    } finally {
      setBusy(false);
    }
  }, [groups, refused]);

  const dismissRefused = useCallback(() => setRefused(null), []);

  return { importGroupFile: run, busy, refused, openAnyway, dismissRefused };
}
