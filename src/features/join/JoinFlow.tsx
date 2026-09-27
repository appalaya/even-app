/**
 * The Join flow (design.md "Invites" → Paste, Join screen, Already have it): the code sheet with its preview, Join
 * through the GroupService, then "Which name is yours?" (`claimMember` / `joinAsNewMember`), or, for an invite naming
 * a group this phone holds on another server, "Move Banff 2026 from <old> to <new>?" (`acceptInviteMove`).
 *
 * One sheet shows at a time; switching waits for the previous one to leave, since iOS presents one at a time.
 */
import { memberColor, newId, type MemberState } from '@even/core';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmojiPickerSheet } from '@/features/emoji/EmojiPickerSheet';
import { hrefs } from '@/features/groups/routes';
import { isNameTaken, nameTakenMessage } from '@/features/groups/names';
import { isStateError, useApp, useGroup, usePrefs } from '@/state';

import { ConfirmSheet } from './ConfirmSheet';
import { hostOf, moveQuestion, problemMessage } from './invite';
import { JoinCodeSheet, type CodeState } from './JoinCodeSheet';
import { PickNameSheet } from './PickNameSheet';

/** The kit Sheet's exit (220 ms) and a frame. */
const SWAP_MS = 260;

type Step =
  | { kind: 'code' }
  | { kind: 'pick'; localId: string }
  | { kind: 'move'; localId: string; name: string; fromServer: string; toServer: string };

export interface JoinFlowProps {
  /** Master switch from the route: false while the route is leaving. */
  visible: boolean;
  /** A code handed over by `/i` or pasted into the dev seed. */
  initialCode?: string;
  /** Start at "Which name is yours?" for a group this phone holds but has not claimed a seat in. */
  pickLocalId?: string;
  onClose: () => void;
  onDone: (href: Href) => void;
  /**
   * Development builds only (the dev seed's screenshots): open "I'm not listed", ask "Is that you on another phone?"
   * about the member with this name, or tap Join once the code reads.
   */
  dev?: { notListed?: boolean; ask?: string; autoJoin?: boolean };
}

export function JoinFlow({
  visible,
  initialCode,
  pickLocalId,
  onClose,
  onDone,
  dev,
}: JoinFlowProps) {
  const { groups } = useApp();
  const [step, setStep] = useState<Step>(
    pickLocalId !== undefined ? { kind: 'pick', localId: pickLocalId } : { kind: 'code' },
  );
  const [shown, setShown] = useState<Step['kind'] | null>(step.kind);
  const [busy, setBusy] = useState(false);

  const go = useCallback((next: Step) => {
    setShown(null);
    setTimeout(() => {
      setStep(next);
      setShown(next.kind);
    }, SWAP_MS);
  }, []);

  // ----- code -----
  const [text, setText] = useState(initialCode ?? '');
  // The preview of the text as last checked, and a Join refusal for the text Join was tapped with.
  const [checked, setChecked] = useState<{ text: string; code: CodeState } | null>(null);
  const [refusal, setRefusal] = useState<{
    text: string;
    message: string;
    update?: boolean;
  } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    if (text.trim() === '') return;
    void groups.previewInvite(text).then((result) => {
      if (request !== latest.current) return;
      setChecked({
        text,
        code: result.ok
          ? { kind: 'read', invite: result.invite }
          : {
              kind: 'error',
              message: problemMessage(result.error),
              update: result.error === 'version',
            },
      });
    });
  }, [text, groups]);

  const code: CodeState =
    text.trim() === ''
      ? { kind: 'empty' }
      : refusal?.text === text
        ? { kind: 'error', message: refusal.message, update: refusal.update === true }
        : checked?.text === text
          ? checked.code
          : { kind: 'empty' };
  const preview = code.kind === 'read' ? code.invite : null;

  const join = async () => {
    if (busy || code.kind !== 'read') return;
    setBusy(true);
    try {
      const result = await groups.joinInvite(text);
      switch (result.kind) {
        case 'joined':
          if (result.needsClaim && !result.waiting) go({ kind: 'pick', localId: result.localId });
          else onDone(hrefs.group(result.localId));
          break;
        case 'already':
          onDone(hrefs.group(result.localId));
          break;
        case 'move':
          go({
            kind: 'move',
            localId: result.localId,
            name: preview?.name ?? 'this group',
            fromServer: result.fromServer,
            toServer: result.toServer,
          });
          break;
        case 'closedGroupInvite':
          setRefusal({ text, message: 'This group was rotated. Ask a member for the new invite.' });
          break;
      }
    } catch (error) {
      const problem = isStateError(error) ? error.code : null;
      if (
        problem === 'checksum' ||
        problem === 'malformed' ||
        problem === 'server' ||
        problem === 'version'
      ) {
        setRefusal({ text, message: problemMessage(problem), update: problem === 'version' });
      } else {
        console.warn('join failed', error instanceof Error ? error.message : error);
      }
    } finally {
      setBusy(false);
    }
  };

  // ----- move -----
  const move = async (s: Extract<Step, { kind: 'move' }>) => {
    setBusy(true);
    try {
      const result = await groups.acceptInviteMove(s.localId, s.toServer);
      if (result.outcome !== 'moved') console.warn('move did not complete', result.outcome);
    } catch (error) {
      console.warn('move failed', error instanceof Error ? error.message : error);
    } finally {
      setBusy(false);
      onDone(hrefs.group(s.localId));
    }
  };

  const localId = step.kind === 'pick' ? step.localId : null;

  // Development: Join as soon as the pasted code reads (the move confirmation's screenshot).
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!__DEV__ || dev?.autoJoin !== true || autoJoined.current || code.kind !== 'read') return;
    autoJoined.current = true;
    const timer = setTimeout(() => void join(), 600);
    return () => clearTimeout(timer);
  });

  return (
    <>
      <JoinCodeSheet
        visible={visible && shown === 'code'}
        onCancel={onClose}
        text={text}
        onChangeText={setText}
        state={code}
        onJoin={() => void join()}
        busy={busy}
      />
      {localId !== null && step.kind === 'pick' && (
        <PickStep
          localId={localId}
          visible={visible && shown === 'pick'}
          fallbackName={preview?.name ?? null}
          onClose={onClose}
          onDone={onDone}
          dev={dev}
        />
      )}
      {step.kind === 'move' && (
        <ConfirmSheet
          visible={visible && shown === 'move'}
          onDismiss={onClose}
          question={moveQuestion(step.name, step.fromServer, step.toServer)}
          body="This invite is for a group you already have, on a different server. Everything you've added moves with it."
          drawnTop={460}
          confirmLabel="Move"
          onConfirm={() => void move(step)}
          cancelLabel="Cancel"
          busy={busy}
        />
      )}
    </>
  );
}

/**
 * "Which name is yours?" for one group, with "I'm not listed" expanding in place and "Is that you on another phone,
 * or a different Maya?" stacked over it (Groups, create and join, extra states 4 and 5).
 */
function PickStep({
  localId,
  visible,
  fallbackName,
  onClose,
  onDone,
  dev,
}: {
  localId: string;
  visible: boolean;
  fallbackName: string | null;
  onClose: () => void;
  onDone: (href: Href) => void;
  dev?: { notListed?: boolean; ask?: string };
}) {
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
      onDone(hrefs.group(localId));
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
      onDone(hrefs.group(localId));
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
