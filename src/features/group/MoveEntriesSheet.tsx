/**
 * MoveEntriesPrompt (boards MoveEntriesPrompt, MoveEntriesPromptDark): the confirmation sheet, its top edge at 484 on
 * the 874 pt board, over the new group (asked once per rotation) or over the old group's settings ("Move entries").
 * Move runs the rescue; Not now, or closing the sheet, answers Not now.
 */
import { ConfirmSheet } from '@/features/join/ConfirmSheet';

import type { MoveOffer } from '../../state';

import { moveEntriesCopy } from './moveEntries';

export interface MoveEntriesSheetProps {
  /** The offer asked about; it stays set while the sheet slides away. */
  offer: MoveOffer | null;
  visible: boolean;
  busy: boolean;
  onMove: () => void;
  onNotNow: () => void;
}

export function MoveEntriesSheet({
  offer,
  visible,
  busy,
  onMove,
  onNotNow,
}: MoveEntriesSheetProps) {
  const copy = moveEntriesCopy(offer?.fromName ?? '', offer?.count ?? 0);
  return (
    <ConfirmSheet
      visible={visible && offer !== null}
      onDismiss={() => {
        if (!busy) onNotNow();
      }}
      question={copy.question}
      body={copy.body}
      confirmLabel="Move"
      onConfirm={onMove}
      cancelLabel="Not now"
      busy={busy}
      drawnTop={484}
    />
  );
}
