/**
 * The import that is refused because the group's invite was regenerated (Groups, create and join, extra states:
 * error copy, "Import, group was regenerated"): the sentence, then "Open old copy anyway" and Cancel, laid out as
 * the other confirmations there (RegenerateInvite's pattern).
 */
import { ConfirmSheet } from '@/features/join/ConfirmSheet';

import { regeneratedMessage, type RefusedImport } from './useImportGroupFile';

export function ImportRefusedSheet({
  refused,
  busy,
  onOpen,
  onDismiss,
}: {
  refused: RefusedImport | null;
  busy: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <ConfirmSheet
      visible={refused !== null}
      onDismiss={onDismiss}
      question={regeneratedMessage(refused?.name ?? 'this group')}
      confirmLabel="Open old copy anyway"
      onConfirm={onOpen}
      cancelLabel="Cancel"
      busy={busy}
    />
  );
}
