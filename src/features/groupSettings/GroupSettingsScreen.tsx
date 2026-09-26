/**
 * Group settings (GroupSettings, RegenerateInvite and States boards; design.md "Screens" → Group settings,
 * "Identity model", "Rotation, moving, closing", "Sync engine" → usage meter, "Group file", "Key patterns" → CSV).
 *
 * Invite, Members (with the edit rules), Server (host, operator, limits, retention, usage, move, and the old copy's
 * delete after a move), Export (CSV, group file), Access (regenerate the invite), Archive group, Leave group.
 * Everything reads from the state hooks and acts through GroupService.
 *
 * Flows no board draws are composed from drawn pieces, with design.md's words where it has them: Rename, Add member
 * and Move open a one-field sheet (the States board's field and error line); Leave opens a confirmation laid out as
 * RegenerateInvite's (the unsent count, "Also delete this group's copy on <host>"); the old copy's delete is a
 * system alert.
 */
import type { MemberState } from '@even/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Clipboard, Share, StyleSheet } from 'react-native';

import { Card, Footnote, Icon, ListRow, Screen, SectionHeader } from '@/components';
import { layout, useTheme } from '@/theme';
import { useApp, useGroup } from '../../state';
import { EmojiPickerSheet } from '../emoji/EmojiPickerSheet';

import { InviteCard } from './InviteCard';
import { LeaveSheet } from './LeaveSheet';
import { MembersCard } from './MembersCard';
import { errorMessage, moveFailure } from './messages';
import { memberRows, removableMembers, hostOf, type MemberAction } from './model';
import { forgetMove, movedFromOf, rememberMove } from './movedFrom';
import { PromptSheet } from './PromptSheet';
import { RegenerateInviteSheet } from './RegenerateInviteSheet';
import { ServerCard } from './ServerCard';
import { useInvite, useServerReport } from './useSettingsData';

/** Development builds only (the dev seed's screenshots): open a sheet or scroll without a touch. */
export interface GroupSettingsDev {
  /** Content offset in points, as if scrolled. */
  scrollY?: number;
  open?: 'regenerate' | 'rename' | 'add' | 'move' | 'leave' | 'avatar';
  /** The member a sheet is about (by name): Rename, Avatar, or the one to remove when regenerating. */
  member?: string;
  /** Typed into Rename / Add member / Move, then submitted. */
  value?: string;
}

export interface GroupSettingsScreenProps {
  localId: string;
  dev?: GroupSettingsDev;
}

type Prompt = { kind: 'rename'; member: MemberState } | { kind: 'add' } | { kind: 'move' };

export function GroupSettingsScreen({ localId, dev }: GroupSettingsScreenProps) {
  const { groups } = useApp();
  const snapshot = useGroup(localId);
  const derived = snapshot.derived;
  const invite = useInvite(localId, derived);
  const report = useServerReport(localId, derived);
  const [oldServer, setOldServer] = useState<string | null>(() => movedFromOf(localId));
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  // The member stays set while the picker slides away; `avatarOpen` shows and hides it.
  const [avatarFor, setAvatarFor] = useState<MemberState | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptError, setPromptError] = useState<string | undefined>(undefined);
  const [promptBusy, setPromptBusy] = useState(false);
  const [leaveFor, setLeaveFor] = useState<{ unsent: number } | null>(null);
  const [leaving, setLeaving] = useState(false);

  const name = derived?.name ?? '';
  const state = derived?.state ?? null;
  const myMemberId = derived?.myMemberId ?? null;
  const rows = useMemo(
    () => (state === null ? [] : memberRows(state, myMemberId)),
    [state, myMemberId],
  );
  const removable = useMemo(
    () => (state === null ? [] : removableMembers(state, myMemberId)),
    [state, myMemberId],
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const fail = (error: unknown, who?: string) => Alert.alert(errorMessage(error, who));

  // ----- invite -----

  const copyCode = () => {
    if (invite === null) return;
    Clipboard.setString(invite.code);
  };

  const shareLink = () => {
    if (invite === null) return;
    void Share.share({ url: invite.link });
  };

  // ----- members -----

  const openPrompt = (next: Prompt) => {
    setPromptError(undefined);
    setPrompt(next);
    setPromptOpen(true);
  };

  // `prompt` stays set while the sheet slides away, so its title does not change under it.
  const closePrompt = () => {
    if (promptBusy) return;
    setPromptOpen(false);
  };

  const submitPrompt = async (value: string) => {
    if (prompt === null) return;
    setPromptBusy(true);
    try {
      if (prompt.kind === 'rename') {
        await groups.updateMember(localId, prompt.member.id, { name: value });
      } else if (prompt.kind === 'add') {
        await groups.addMember(localId, value);
      } else {
        const result = await groups.moveServer(localId, value.trim());
        const problem = moveFailure(result, hostOf(result.fromServer));
        if (problem !== null) {
          setPromptError(problem);
          return;
        }
        rememberMove(localId, result.fromServer);
        setOldServer(result.fromServer);
      }
      setPromptOpen(false);
    } catch (error) {
      setPromptError(errorMessage(error, prompt.kind === 'move' ? undefined : value));
    } finally {
      setPromptBusy(false);
    }
  };

  const onMemberAction = (action: MemberAction, member: MemberState) => {
    switch (action) {
      case 'rename':
        openPrompt({ kind: 'rename', member });
        return;
      case 'avatar':
        setAvatarFor(member);
        setAvatarOpen(true);
        return;
      case 'archive':
        groups.archiveMember(localId, member.id).catch((e) => fail(e));
        return;
      case 'unarchive':
        groups.unarchiveMember(localId, member.id).catch((e) => fail(e, member.name));
        return;
    }
  };

  const setAvatar = (emoji: string | null) => {
    const member = avatarFor;
    setAvatarOpen(false);
    if (member === null) return;
    groups.updateMember(localId, member.id, { emoji }).catch((e) => fail(e));
  };

  const deleteOldCopy = () => {
    if (oldServer === null) return;
    const host = hostOf(oldServer);
    Alert.alert(`Delete the copy on ${host}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void groups.deleteServerCopy(localId, oldServer).then((result) => {
            if (result.outcome === 'failed' && result.error === 'current_server') return;
            forgetMove(localId);
            setOldServer(null);
          });
        },
      },
    ]);
  };

  // ----- export -----

  const exportCsv = () => {
    groups.exportCsv(localId).catch((e) => fail(e));
  };

  const exportGroupFile = () => {
    groups.exportGroupFile(localId, { dialogTitle: name }).catch((e) => fail(e));
  };

  // ----- access -----

  const regenerate = async (removeMemberId: string | undefined) => {
    setRotating(true);
    try {
      const result = await groups.rotateInvite(
        localId,
        removeMemberId === undefined ? {} : { removeMemberId },
      );
      setRegenerateOpen(false);
      router.replace({ pathname: '/group/[id]/settings', params: { id: result.localId } });
      // "You'll share the new link next": once the new group is on the server.
      if (result.invite.ready) void Share.share({ url: result.invite.link });
    } catch (error) {
      fail(error);
    } finally {
      setRotating(false);
    }
  };

  // ----- archive, leave -----

  const toggleArchive = () => {
    if (state?.archived === true) {
      groups.unarchiveGroup(localId).catch((e) => fail(e));
      return;
    }
    groups.archiveGroup(localId).then(goBack, (e) => fail(e));
  };

  const leave = async (deleteServerCopy: boolean) => {
    setLeaving(true);
    try {
      await groups.leaveGroup(localId, { deleteServerCopy });
      setLeaveFor(null);
      router.dismissTo('/');
    } catch (error) {
      fail(error);
    } finally {
      setLeaving(false);
    }
  };

  const openLeave = async () => {
    setLeaveFor({ unsent: await groups.unsentCount(localId).catch(() => 0) });
  };

  // ----- development: open a sheet or scroll for a screenshot -----

  const devDone = useRef(false);
  useEffect(() => {
    if (!__DEV__ || dev?.open === undefined || devDone.current || state === null) return;
    devDone.current = true;
    const member = [...state.members.values()].find((m) => m.name === dev.member);
    const open = dev.open;
    // After this render, as a tap would.
    setTimeout(() => {
      if (open === 'regenerate') setRegenerateOpen(true);
      else if (open === 'avatar' && member !== undefined) {
        setAvatarFor(member);
        setAvatarOpen(true);
      } else if (open === 'leave') {
        void groups
          .unsentCount(localId)
          .catch(() => 0)
          .then((unsent) => setLeaveFor({ unsent }));
      } else if (open === 'rename' && member !== undefined) {
        setPrompt({ kind: 'rename', member });
        setPromptOpen(true);
      } else if (open === 'add' || open === 'move') {
        setPrompt({ kind: open });
        setPromptOpen(true);
      }
    }, 0);
  }, [dev, state, groups, localId]);

  // ----- layout -----

  const readOnly = derived?.readOnly ?? null;
  const frozen = readOnly === 'closed' || readOnly === 'hidden' || readOnly === 'no_secret';

  return (
    <Screen
      back={{ label: name, onPress: goBack }}
      title="Settings"
      titleInset={130}
      contentContainerStyle={
        __DEV__ && dev?.scrollY !== undefined
          ? { transform: [{ translateY: -dev.scrollY }] }
          : undefined
      }
    >
      {derived !== null && (
        <>
          <SectionHeader variant="settings" spacingTop={16}>
            Invite
          </SectionHeader>
          <InviteCard
            link={invite?.link ?? null}
            ready={invite?.ready === true}
            onCopyCode={copyCode}
            onShareLink={shareLink}
          />

          {state !== null && (
            <>
              <SectionHeader variant="settings">Members</SectionHeader>
              <MembersCard
                rows={rows}
                readOnly={readOnly !== null}
                onAction={onMemberAction}
                onAdd={() => openPrompt({ kind: 'add' })}
              />
              <Footnote>
                You can edit your own name and avatar. Anyone can archive a member who&apos;s left.
                Archived members stay in past expenses and balances.
              </Footnote>
            </>
          )}

          <SectionHeader variant="settings">Server</SectionHeader>
          <ServerCard
            serverUrl={derived.row.serverUrl}
            report={report}
            oldServer={oldServer}
            readOnly={frozen}
            onMove={() => openPrompt({ kind: 'move' })}
            onDeleteOldCopy={deleteOldCopy}
          />

          {state !== null && (
            <>
              <SectionHeader variant="settings">Export</SectionHeader>
              <Card radius="group" separatorInset={16} style={styles.card}>
                <ListRow title="Export CSV" chevron onPress={exportCsv} />
                <ListRow title="Export group file" chevron onPress={exportGroupFile} />
              </Card>
              <Footnote>
                A group file contains the invite. Anyone who has it can open the group.
              </Footnote>
            </>
          )}

          {!frozen && (
            <>
              <SectionHeader variant="settings">Access</SectionHeader>
              <Card radius="group" style={styles.card}>
                <ActionRow
                  icon="regenerate"
                  label="Regenerate invite link"
                  tone="accent"
                  onPress={() => setRegenerateOpen(true)}
                />
              </Card>
              <Footnote>
                Makes a new link and closes this one. Everyone still in the group will need the new
                link.
              </Footnote>

              <Card radius="group" style={[styles.card, styles.spaced]}>
                <ActionRow
                  icon="archive"
                  label={state?.archived === true ? 'Unarchive group' : 'Archive group'}
                  tone="text"
                  onPress={toggleArchive}
                />
              </Card>
              <Footnote>Read-only for everyone. Anyone can unarchive.</Footnote>
            </>
          )}

          <Card radius="group" style={[styles.card, styles.spaced]}>
            <ActionRow
              icon="leave"
              label="Leave group"
              tone="text"
              weight="semibold"
              onPress={() => void openLeave()}
            />
          </Card>
          <Footnote>Removes {name} from this phone. The others keep it.</Footnote>
        </>
      )}

      <RegenerateInviteSheet
        visible={regenerateOpen}
        members={removable}
        initialRemoveId={__DEV__ ? removable.find((m) => m.name === dev?.member)?.id : undefined}
        busy={rotating}
        onRegenerate={(id) => void regenerate(id)}
        onDismiss={() => setRegenerateOpen(false)}
      />
      <PromptSheet
        visible={promptOpen}
        title={
          prompt?.kind === 'add'
            ? 'Add member'
            : prompt?.kind === 'move'
              ? 'Move to another server'
              : 'Rename'
        }
        submitLabel={prompt?.kind === 'add' ? 'Add' : prompt?.kind === 'move' ? 'Move' : 'Save'}
        initialValue={
          __DEV__ && dev?.value !== undefined
            ? dev.value
            : prompt?.kind === 'rename'
              ? prompt.member.name
              : prompt?.kind === 'move'
                ? 'https://'
                : ''
        }
        placeholder={prompt?.kind === 'move' ? 'https://sync.example.net' : 'Add a name'}
        keyboard={prompt?.kind === 'move' ? 'url' : 'name'}
        error={promptError}
        busy={promptBusy}
        submitOnOpen={__DEV__ && dev?.value !== undefined}
        onEdit={() => setPromptError(undefined)}
        onSubmit={(value) => void submitPrompt(value)}
        onDismiss={closePrompt}
      />
      {derived !== null && (
        <LeaveSheet
          visible={leaveFor !== null}
          groupName={name}
          host={hostOf(derived.row.serverUrl)}
          unsent={leaveFor?.unsent ?? 0}
          busy={leaving}
          onLeave={(deleteServerCopy) => void leave(deleteServerCopy)}
          onDismiss={() => setLeaveFor(null)}
        />
      )}
      <EmojiPickerSheet
        visible={avatarOpen}
        value={avatarFor?.emoji ?? null}
        name={avatarFor?.name ?? ''}
        color={avatarFor?.color}
        onPick={(emoji) => setAvatar(emoji)}
        onUseInitials={() => setAvatar(null)}
        onDismiss={() => setAvatarOpen(false)}
      />
    </Screen>
  );
}

/** A settings row led by a 20 pt glyph: "Regenerate invite link" (accent), "Archive group", "Leave group". */
function ActionRow({
  icon,
  label,
  tone,
  weight = 'medium',
  onPress,
}: {
  icon: 'regenerate' | 'archive' | 'leave';
  label: string;
  tone: 'accent' | 'text';
  weight?: 'medium' | 'semibold';
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <ListRow
      leading={<Icon name={icon} size={20} color={tokens[tone]} />}
      title={label}
      titleColor={tone}
      titleWeight={weight}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: layout.gutter },
  spaced: { marginTop: 24 },
});
