/**
 * `FileIO` on the device: expo-file-system writes into the cache directory, expo-sharing opens the share sheet, and
 * the temporary file is deleted as soon as the sheet closes. Picking uses expo-file-system's system picker.
 * Never imported by Node tests.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { FileIO } from './fileIO';

export const expoFileIO: FileIO = {
  async share({ name, contents, mimeType, uti, dialogTitle }) {
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    try {
      await file.write(contents);
      await Sharing.shareAsync(file.uri, {
        mimeType,
        ...(uti === undefined ? {} : { UTI: uti }),
        ...(dialogTitle === undefined ? {} : { dialogTitle }),
      });
    } finally {
      try {
        if (file.exists) file.delete();
      } catch {
        // The OS clears the cache directory eventually; nothing else to do.
      }
    }
  },

  async pick(options) {
    const picked = await File.pickFileAsync({ mimeTypes: options?.mimeTypes ?? ['*/*'] });
    if (picked.canceled) return null;
    return { name: picked.result.name, text: await picked.result.text() };
  },
};
