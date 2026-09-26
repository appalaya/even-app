/**
 * The Join flow (design.md "Invites" → Paste, Join screen, Already have it): the code sheet with its preview, Join
 * through the GroupService, then "Which name is yours?" (`claimMember` / `joinAsNewMember`), or, for an invite naming
 * a group this phone holds on another server, "Move Banff 2026 from <old> to <new>?" (`acceptInviteMove`).
 *
 * One sheet shows at a time; switching waits for the previous one to leave, since iOS presents one at a time.
 */
import type { MemberState } from '@even/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { hrefs } from '@/features/groups/routes';
import { isNameTaken, nameTakenMessage } from '@/features/groups/names';
import { isStateError, useApp, useGroup, usePrefs } from '@/state';
import type { Href } from 'expo-router';

import { ConfirmSheet } from './ConfirmSheet';
import { hostOf, moveQuestion, problemMessage } from './invite';
import { JoinCodeSheet, type CodeState } from './JoinCodeSheet';
import { PickNameSheet } from './PickNameSheet';

/** The kit Sheet's exit (220 ms) and a frame. */
const SWAP_MS = 260;

type Step =
  | { kind: 'code' }
  | { kind: 'pick'; localId: string }
  | { kind: 'sameName'; localId: string; member: MemberState }
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
}

export function JoinFlow({ visible, initialCode, pickLocalId, onClose, onDone }: JoinFlowProps) {
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
  const [refusal, setRefusal] = useState<{ text: string; message: string } | null>(null);
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
          : { kind: 'error', message: problemMessage(result.error) },
      });
    });
  }, [text, groups]);

  const code: CodeState =
    text.trim() === ''
      ? { kind: 'empty' }
      : refusal?.text === text
        ? { kind: 'error', message: refusal.message }
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
        setRefusal({ text, message: problemMessage(problem) });
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

  const localId = step.kind === 'code' ? null : step.localId;

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
      {localId !== null && (
        <PickStep
          localId={localId}
          visible={visible && shown === 'pick'}
          fallbackName={preview?.name ?? null}
          onClose={onClose}
          onDone={onDone}
          onSameName={(member) => go({ kind: 'sameName', localId, member })}
          reopen={() => go({ kind: 'pick', localId })}
          sameName={step.kind === 'sameName' ? step.member : null}
          sameNameVisible={visible && shown === 'sameName'}
        />
      )}
      {step.kind === 'move' && (
        <ConfirmSheet
          visible={visible && shown === 'move'}
          onDismiss={onClose}
          question={moveQuestion(step.name, step.fromServer, step.toServer)}
          confirmLabel="Move"
          onConfirm={() => void move(step)}
          cancelLabel="Cancel"
          busy={busy}
        />
      )}
    </>
  );
}

/** "Which name is yours?" for one group, with its two follow-ups. */
function PickStep({
  localId,
  visible,
  fallbackName,
  onClose,
  onDone,
  onSameName,
  reopen,
  sameName,
  sameNameVisible,
}: {
  localId: string;
  visible: boolean;
  fallbackName: string | null;
  onClose: () => void;
  onDone: (href: Href) => void;
  onSameName: (member: MemberState) => void;
  reopen: () => void;
  sameName: MemberState | null;
  sameNameVisible: boolean;
}) {
  const { groups } = useApp();
  const { prefs } = usePrefs();
  const { derived } = useGroup(localId);
  const [busy, setBusy] = useState(false);
  const [notListed, setNotListed] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const members = derived?.state
    ? [...derived.state.members.values()].filter((m) => !m.archived && !m.unknown)
    : [];

  const openNotListed = useCallback(() => {
    setNotListed(true);
    setNewName((current) => (current === '' ? (prefs?.name ?? '') : current));
  }, [prefs]);

  const claim = async (member: MemberState) => {
    setBusy(true);
    setFormError(undefined);
    try {
      await groups.claimMember(localId, member.id);
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
      await groups.joinAsNewMember(localId, clean, prefs?.emoji ?? undefined);
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

  const name = derived?.name.trim() ? derived.name : (fallbackName ?? 'a group');
  return (
    <>
      <PickNameSheet
        visible={visible}
        onClose={onClose}
        groupName={name}
        host={hostOf(derived?.row.serverUrl ?? '')}
        currency={derived?.currency ?? null}
        members={members}
        onPick={(m) => (m.devices.length > 0 ? onSameName(m) : void claim(m))}
        notListed={notListed}
        onNotListed={openNotListed}
        newName={newName}
        onChangeNewName={(value) => {
          setNewName(value);
          setNameError(undefined);
        }}
        onAddSelf={() => void addSelf()}
        nameError={nameError}
        formError={formError}
        busy={busy}
      />
      {sameName !== null && (
        <ConfirmSheet
          visible={sameNameVisible}
          onDismiss={reopen}
          question={`Is that you on another phone, or are you a different ${sameName.name}?`}
          confirmLabel="That's me"
          onConfirm={() => void claim(sameName)}
          cancelLabel={`I'm a different ${sameName.name}`}
          onCancel={() => {
            openNotListed();
            reopen();
          }}
          busy={busy}
        />
      )}
    </>
  );
}
