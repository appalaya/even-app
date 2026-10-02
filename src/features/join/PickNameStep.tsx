/**
 * "Which name is yours?" for one group this phone holds without a seat: the name list with "I'm not listed" expanding
 * in place and "Is that you on another phone, or a different Maya?" stacked over it (Join, JoinDark; Groups, create
 * and join, extra states 4 and 5). Shared by the Join flow (after Join) and by Group (re-offered on every focus until
 * a seat is claimed, as SeatPick draws it: `again`). It only claims (`claimMember`) or adds you (`joinAsNewMember`);
 * `onClose` belongs to the host, and nothing here removes or changes the group when the sheet closes.
 *
 * Offered again (`again`), a name this phone claimed before reads "this phone" and a tap on it skips the other-phone
 * question (`namePick`); when this phone claimed another name too, "This phone was Maya before" asks first
 * (SeatSameDevice): "Continue as Maya" claims it, "Choose again" goes back to the list. The Join boards draw neither,
 * so after Join every claimed name reads "joined" and asks, as before.
 */
import { memberColor, newId, type MemberState, LIMITS } from '@even/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmojiPickerSheet } from '@/features/emoji/EmojiPickerSheet';
import { namePick, sameDeviceWords, seatMark, type NamePick } from '@/features/group/model';
import { isNameTaken, nameTakenMessage } from '@/features/groups/names';
import { describeForLog, isStateError, useApp, useGroup, usePrefs } from '@/state';

import { ConfirmSheet } from './ConfirmSheet';
import { hostOf } from './invite';
import { PickNameSheet } from './PickNameSheet';

/**
 * The kit Sheet's exit (220 ms) and a frame. iOS presents a question stacked over the sheet from the sheet's own
 * modal; closing both at once makes UIKit refuse one of the two dismissals, which leaves an empty modal presented and
 * no later sheet (Scan to join, Done adding) can present. So after an answer the question leaves first, then the sheet.
 */
const STACKED_EXIT_MS = 260;

export interface PickNameStepProps {
  localId: string;
  visible: boolean;
  /** Offered again on Group to a phone that already holds the group: "You're already in" (SeatPick). */
  again?: boolean;
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
  again = false,
  fallbackName,
  onClose,
  onClaimed,
  dev,
}: PickNameStepProps) {
  const { groups, deviceId } = useApp();
  const { prefs } = usePrefs();
  const { derived } = useGroup(localId);
  const [busy, setBusy] = useState(false);
  const [notListed, setNotListed] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  // The new seat's id is chosen now, so its avatar previews the colour it will have.
  const [newMemberId] = useState(() => newId());
  const [picking, setPicking] = useState(false);
  const [sameName, setSameName] = useState<MemberState | null>(null);
  // "This phone was Maya before": the name tapped and the other names this phone claimed. The words stay set while
  // the question slides away after an answer; `sameDeviceOpen` says whether it shows.
  const [sameDevice, setSameDevice] = useState<{
    member: MemberState;
    others: MemberState[];
  } | null>(null);
  const [sameDeviceOpen, setSameDeviceOpen] = useState(false);
  // A name was claimed from a stacked question: the sheet stays up (whatever the host says) until the question is gone.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    },
    [],
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const state = derived?.state ?? null;
  const members = state ? [...state.members.values()].filter((m) => !m.archived && !m.unknown) : [];
  // Offered again on Group (SeatPick), the sheet knows the names this phone claimed; Join draws every claimed name
  // "joined" and asks about each (Join; Groups, create and join, extra states 5).
  const thisPhone = again
    ? new Set(members.filter((m) => seatMark(m, deviceId) === 'thisPhone').map((m) => m.id))
    : undefined;

  /** A tap on a name: claim it, or ask first (another phone's name; one of this phone's two). */
  const pick = (member: MemberState) => {
    if (state === null) return;
    const next: NamePick = again
      ? namePick(state, member, deviceId)
      : member.devices.length > 0
        ? { kind: 'otherPhone' }
        : { kind: 'claim' };
    if (next.kind === 'otherPhone') setSameName(member);
    else if (next.kind === 'sameDevice') {
      setSameDevice({ member, others: next.others });
      setSameDeviceOpen(true);
    } else void claim(member);
  };

  /** Opens "I'm not listed": from App settings' defaults, or empty after "Different Maya". */
  const openNotListed = useCallback(
    (fill: boolean) => {
      setNotListed(true);
      setNameError(undefined);
      if (fill) {
        setNewName(prefs?.name ?? '');
        setNewEmoji(prefs?.emoji ?? null);
      } else {
        setNewName('');
      }
    },
    [prefs],
  );

  const claim = async (member: MemberState) => {
    const stacked = sameName !== null || sameDeviceOpen;
    setBusy(true);
    setFormError(undefined);
    try {
      await groups.claimMember(localId, member.id);
      setSameName(null);
      setSameDeviceOpen(false);
      if (stacked) {
        setLeaving(true);
        leaveTimer.current = setTimeout(() => {
          leaveTimer.current = null;
          setLeaving(false);
          onClaimed();
        }, STACKED_EXIT_MS);
      } else {
        onClaimed();
      }
    } catch (error) {
      setFormError(`Couldn't join as ${member.name}. Try again.`);
      console.warn('claim failed', describeForLog(error));
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
      else if (isStateError(error, 'members_full'))
        setFormError(`A group has at most ${LIMITS.membersMax} members.`);
      else {
        setFormError("Couldn't add you. Try again.");
        console.warn('join as new member failed', describeForLog(error));
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
      if (asked !== undefined) pick(asked);
    }, 500);
    return () => clearTimeout(timer);
  });

  const name = derived?.name.trim() ? derived.name : (fallbackName ?? 'a group');
  const sameDeviceText =
    sameDevice === null
      ? null
      : sameDeviceWords(
          sameDevice.member.name,
          sameDevice.others.map((m) => m.name),
        );
  return (
    <PickNameSheet
      visible={visible || leaving}
      onClose={onClose}
      again={again}
      groupName={name}
      host={hostOf(derived?.row.serverUrl ?? '')}
      currency={derived?.currency ?? null}
      members={members}
      thisPhone={thisPhone}
      onPick={pick}
      notListed={notListed}
      onToggleNotListed={() => (notListed ? setNotListed(false) : openNotListed(true))}
      newName={newName}
      onChangeNewName={(value) => {
        setNewName(value);
        setNameError(undefined);
      }}
      newEmoji={newEmoji}
      newColor={memberColor(newMemberId)}
      onChangeAvatar={() => setPicking(true)}
      onAddSelf={() => void addSelf()}
      nameError={nameError}
      formError={formError}
      busy={busy || leaving}
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
      {/* SeatSameDevice: drawn at 520, stacked over the pick sheet like the question above. */}
      <ConfirmSheet
        visible={sameDeviceOpen}
        onDismiss={() => setSameDeviceOpen(false)}
        question={sameDeviceText?.question ?? ''}
        body={sameDeviceText?.body ?? ''}
        drawnTop={520}
        confirmLabel={sameDeviceText?.confirm ?? ''}
        onConfirm={() => {
          if (sameDevice !== null) void claim(sameDevice.member);
        }}
        cancelLabel="Choose again"
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
