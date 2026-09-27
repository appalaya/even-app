/**
 * "Which name is yours?" for one group this phone holds without a seat: the name list with "I'm not listed" expanding
 * in place and "Is that you on another phone, or a different Maya?" stacked over it (Join, JoinDark; Groups, create
 * and join, extra states 4 and 5). Shared by the Join flow (after Join) and by Group (re-offered on every focus until
 * a seat is claimed). It only claims (`claimMember`) or adds you (`joinAsNewMember`); `onClose` belongs to the host,
 * and nothing here removes or changes the group when the sheet closes.
 */
import { memberColor, newId, type MemberState } from '@even/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmojiPickerSheet } from '@/features/emoji/EmojiPickerSheet';
import { isNameTaken, nameTakenMessage } from '@/features/groups/names';
import { isStateError, useApp, useGroup, usePrefs } from '@/state';

import { ConfirmSheet } from './ConfirmSheet';
import { hostOf } from './invite';
import { PickNameSheet } from './PickNameSheet';

export interface PickNameStepProps {
  localId: string;
  visible: boolean;
  /** The invite's group name, until the log's arrives ("a group" when neither is known). */
  fallbackName: string | null;
  /** The close button, a scrim tap or a swipe down. */
  onClose: () => void;
  /** A name was claimed or added: this phone has its seat. */
  onClaimed: () => void;
  /** Development builds only (the dev seed's screenshots): open "I'm not listed", or ask about this name. */
  dev?: { notListed?: boolean; ask?: string };
}

export function PickNameStep({
  localId,
  visible,
  fallbackName,
  onClose,
  onClaimed,
  dev,
}: PickNameStepProps) {
  const { groups } = useApp();
  const { prefs } = usePrefs();
  const { derived } = useGroup(localId);
  const [busy, setBusy] = useState(false);
  const [notListed, setNotListed] = useState(false);
  const [newName, setNewName] = useState('');
  const [fromDefaults, setFromDefaults] = useState(false);
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  // The new seat's id is chosen now, so its avatar previews the colour it will have.
  const [newMemberId] = useState(() => newId());
  const [picking, setPicking] = useState(false);
  const [sameName, setSameName] = useState<MemberState | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const members = derived?.state
    ? [...derived.state.members.values()].filter((m) => !m.archived && !m.unknown)
    : [];

  /** Opens "I'm not listed": from App settings' defaults, or empty after "Different Maya". */
  const openNotListed = useCallback(
    (fill: boolean) => {
      setNotListed(true);
      setNameError(undefined);
      if (fill) {
        const name = prefs?.name ?? '';
        setNewName(name);
        setFromDefaults(name !== '');
        setNewEmoji(prefs?.emoji ?? null);
      } else {
        setNewName('');
        setFromDefaults(false);
      }
    },
    [prefs],
  );

  const claim = async (member: MemberState) => {
    setBusy(true);
    setFormError(undefined);
    try {
      await groups.claimMember(localId, member.id);
      setSameName(null);
      onClaimed();
    } catch (error) {
      setFormError("That name couldn't be claimed.");
      console.warn('claim failed', error instanceof Error ? error.message : error);
    } finally {
      setBusy(false);
    }
  };

  const addSelf = async () => {
    const clean = newName.trim();
    if (clean === '') return;
    if (
      isNameTaken(
        clean,
        members.map((m) => m.name),
      )
    ) {
      setNameError(nameTakenMessage(clean));
      return;
    }
    setBusy(true);
    setFormError(undefined);
    try {
      await groups.joinAsNewMember(localId, clean, newEmoji ?? undefined, { id: newMemberId });
      onClaimed();
    } catch (error) {
      if (isStateError(error, 'name_taken')) setNameError(nameTakenMessage(clean));
      else if (isStateError(error, 'members_full')) setFormError('This group is full.');
      else {
        setFormError("You couldn't be added.");
        console.warn('join as new member failed', error instanceof Error ? error.message : error);
      }
    } finally {
      setBusy(false);
    }
  };

  // Development: open a drawn state once the members are known.
  const devShown = useRef(false);
  useEffect(() => {
    if (!__DEV__ || devShown.current || members.length === 0) return;
    if (dev?.notListed !== true && dev?.ask === undefined) return;
    devShown.current = true;
    const timer = setTimeout(() => {
      if (dev.notListed === true) openNotListed(true);
      const asked = members.find((m) => m.name === dev.ask);
      if (asked !== undefined) setSameName(asked);
    }, 500);
    return () => clearTimeout(timer);
  });

  const name = derived?.name.trim() ? derived.name : (fallbackName ?? 'a group');
  return (
    <PickNameSheet
      visible={visible}
      onClose={onClose}
      groupName={name}
      host={hostOf(derived?.row.serverUrl ?? '')}
      currency={derived?.currency ?? null}
      members={members}
      onPick={(m) => (m.devices.length > 0 ? setSameName(m) : void claim(m))}
      notListed={notListed}
      onToggleNotListed={() => (notListed ? setNotListed(false) : openNotListed(true))}
      newName={newName}
      onChangeNewName={(value) => {
        setNewName(value);
        setFromDefaults(false);
        setNameError(undefined);
      }}
      newEmoji={newEmoji}
      newColor={memberColor(newMemberId)}
      onChangeAvatar={() => setPicking(true)}
      fromDefaults={fromDefaults}
      onAddSelf={() => void addSelf()}
      nameError={nameError}
      formError={formError}
      busy={busy}
    >
      {/* Stacked over the pick sheet, so iOS presents them from its modal. */}
      <ConfirmSheet
        visible={sameName !== null}
        onDismiss={() => setSameName(null)}
        question={`Is that you on another phone, or a different ${sameName?.name ?? ''}?`}
        body={`If it's you, this phone joins as ${sameName?.name ?? ''} too. If not, you'll add yourself under another name.`}
        drawnTop={512}
        confirmLabel="It's me"
        onConfirm={() => {
          if (sameName !== null) void claim(sameName);
        }}
        cancelLabel={`Different ${sameName?.name ?? ''}`}
        onCancel={() => {
          setSameName(null);
          openNotListed(false);
        }}
        busy={busy}
      />
      <EmojiPickerSheet
        visible={picking}
        onDismiss={() => setPicking(false)}
        value={newEmoji}
        onPick={(emoji) => {
          setNewEmoji(emoji);
          setPicking(false);
        }}
        onUseInitials={() => {
          setNewEmoji(null);
          setPicking(false);
        }}
        name={newName.trim() === '' ? '?' : newName}
        color={memberColor(newMemberId)}
      />
    </PickNameSheet>
  );
}
