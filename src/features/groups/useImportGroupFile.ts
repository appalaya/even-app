/**
 * "Import group file" (Groups and App settings): pick a `.even` file, import it through the GroupService, and open
 * the group. A refused import (the group is closed or hidden here) and an invalid file have no board yet, so they
 * are reported back to the caller unchanged (listed in the stack report).
 */
import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { useApp } from '@/state';

import { hrefs } from './routes';

export function useImportGroupFile() {
  const { groups } = useApp();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await groups.pickGroupFile();
      if (text === null) return;
      const result = await groups.importGroupFile(text);
      if (result.outcome === 'imported') router.push(hrefs.group(result.localId));
    } catch (error) {
      console.warn('import group file failed', error instanceof Error ? error.message : error);
    } finally {
      setBusy(false);
    }
  }, [busy, groups]);

  return { importGroupFile: run, busy };
}
