/**
 * The tiny file surface the group file and CSV export need: write a file and hand it to the share sheet, and let the
 * user pick a file to read. `expoFileIO.ts` binds expo-file-system and expo-sharing; tests use `memoryFileIO.ts`.
 * Types only here, so Node code can depend on it without pulling in an Expo module.
 */

export interface ShareableFile {
  /** File name including the extension, e.g. `Banff 2026.even`. */
  name: string;
  /** UTF-8 text. */
  contents: string;
  mimeType: string;
  /** iOS Uniform Type Identifier, when the extension alone would not do. */
  uti?: string;
  /** Android share-sheet title. */
  dialogTitle?: string;
}

export interface PickedFile {
  name: string;
  text: string;
}

export interface FileIO {
  /**
   * Writes `file` to a temporary location, opens the share sheet for it, and deletes the temporary copy when the
   * sheet closes (a CSV is decrypted content and a group file carries the secret: neither may linger on disk).
   */
  share(file: ShareableFile): Promise<void>;
  /** Lets the user pick one file and reads it as UTF-8 text; null if they cancel. */
  pick(options?: { mimeTypes?: string[] }): Promise<PickedFile | null>;
}
