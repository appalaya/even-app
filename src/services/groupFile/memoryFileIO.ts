/** In-memory `FileIO` for Node tests: records what was shared and serves queued picks. */
import type { FileIO, PickedFile, ShareableFile } from './fileIO';

export interface MemoryFileIO extends FileIO {
  /** Every file handed to the share sheet, in order. */
  readonly shared: ShareableFile[];
  /** Queues the result of the next `pick` (null = the user cancels). */
  queuePick(file: PickedFile | null): void;
}

export function createMemoryFileIO(): MemoryFileIO {
  const shared: ShareableFile[] = [];
  const picks: (PickedFile | null)[] = [];
  return {
    shared,
    queuePick(file) {
      picks.push(file);
    },
    async share(file) {
      shared.push({ ...file });
    },
    async pick() {
      return picks.length > 0 ? (picks.shift() ?? null) : null;
    },
  };
}
