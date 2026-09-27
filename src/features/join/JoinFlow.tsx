/**
 * The Join flow (design.md "Invites" → Paste, Join screen, Already have it): the code sheet with its preview (a code
 * typed, pasted, or read by the Scan pill's scanner, `ScanSheet`, which hands it back to the code sheet), Join
 * through the GroupService, then "Which name is yours?" (`PickNameStep`: `claimMember` / `joinAsNewMember`), or, for
 * an invite naming a group this phone holds on another server, "Move Banff 2026 from <old> to <new>?"
 * (`acceptInviteMove`). Closing any of its sheets (`onClose`) leaves the Join route for Groups; the group a join
 * created stays, unclaimed, and Group offers the name pick again when it is opened.
 *
 * A join whose first sync fails (the server unreachable, the group blocked there, not an Even server, a server that
 * needs updating, anything else) is undone, since nothing of this phone's is in the group yet, and the reason shows
 * under Join (JoinCodeFailed, JoinCodeRefused) with Join still on to try again.
 *
 * One sheet shows at a time; switching waits for the previous one to leave, since iOS presents one at a time.
 */
import type { Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { hrefs } from '@/features/groups/routes';
import { isStateError, useApp } from '@/state';

import { ConfirmSheet } from './ConfirmSheet';
import {
  joinFailureMessage,
  joinFailureOf,
  moveQuestion,
  problemMessage,
  type JoinFailure,
} from './invite';
import { JoinCodeSheet, type CodeState } from './JoinCodeSheet';
import { PickNameStep } from './PickNameStep';
import { ScanSheet } from './ScanSheet';

/** The kit Sheet's exit (220 ms) and a frame. */
const SWAP_MS = 260;

type Step =
  | { kind: 'code' }
  | { kind: 'scan' }
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
  // Why the last Join did not go through, for the text it was tapped with: the line under Join.
  const [failure, setFailure] = useState<{ text: string; message: string } | null>(null);
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

  // A scanned invite's code goes into the field as if pasted, and the code sheet comes back to preview it.
  const onScanned = useCallback(
    (scanned: string) => {
      setText(scanned);
      go({ kind: 'code' });
    },
    [go],
  );

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
    const { host } = code.invite;
    const fail = (why: JoinFailure) => setFailure({ text, message: joinFailureMessage(why, host) });
    setBusy(true);
    setFailure(null);
    try {
      const result = await groups.joinInvite(text);
      const failed = joinFailureOf(result);
      if (failed !== null) {
        // The first sync did not complete: undo the join so that Join tries it afresh.
        await groups.leaveGroup(result.localId).catch((error: unknown) => {
          console.warn(
            'undoing a failed join failed',
            error instanceof Error ? error.message : error,
          );
        });
        fail(failed);
        return;
      }
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
          setRefusal({
            text,
            message: "This group's invite was regenerated. Ask a member for the new one.",
          });
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
        fail('unknown');
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
        onScan={() => go({ kind: 'scan' })}
        state={code}
        onJoin={() => void join()}
        busy={busy}
        failure={failure?.text === text ? failure.message : undefined}
      />
      {step.kind === 'scan' && (
        <ScanSheet
          visible={visible && shown === 'scan'}
          onCancel={() => go({ kind: 'code' })}
          onPasteInstead={() => go({ kind: 'code' })}
          onFound={onScanned}
        />
      )}
      {localId !== null && step.kind === 'pick' && (
        <PickNameStep
          localId={localId}
          visible={visible && shown === 'pick'}
          fallbackName={preview?.name ?? null}
          onClose={onClose}
          onClaimed={() => onDone(hrefs.group(localId))}
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
