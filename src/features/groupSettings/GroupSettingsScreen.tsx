/**
 * Group settings (GroupSettings, GroupSettingsStates, RegenerateInvite and States boards; design.md "Screens" → Group
 * settings, "Identity model", "Rotation, moving, closing", "Sync engine" → usage meter, "Group file", "Key patterns"
 * → CSV).
 *
 * Name (→ Rename group), Invite, Members (with the edit rules; Add member), Server (host, operator, limits,
 * retention, usage with its 80 % warning, Move server with Check, and the old copy's delete after a move), Export
 * (CSV, group file), Access (regenerate the invite), Archive group, Leave group (unsent entries, the server-copy
 * checkbox). Everything reads from the state hooks and acts through GroupService. A member's rename uses the Rename
 * sheet's layout; the old copy's delete is confirmed by a system alert (no board draws it).
 */
import type { MemberState } from '@even/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Alert, Share, StyleSheet, View } from 'react-native';

import { LIMITS } from '@even/core';

import { AppText, Card, Footnote, Icon, ListRow, Screen, SectionHeader } from '@/components';
import { layout, radii, useTheme } from '@/theme';
import { useApp, useGroup } from '../../state';
import { EmojiPickerSheet } from '../emoji/EmojiPickerSheet';

import { AddMemberSheet } from './AddMemberSheet';
import { InviteCard } from './InviteCard';
import { LeaveSheet } from './LeaveSheet';
import { MembersCard } from './MembersCard';
import { errorMessage, moveFailure } from './messages';
import { memberRows, removableMembers, hostOf, type MemberAction } from './model';
import { forgetMove, movedFromOf, rememberMove } from './movedFrom';
import { MoveServerSheet } from './MoveServerSheet';
import { PromptSheet } from './PromptSheet';
import { RegenerateInviteSheet } from './RegenerateInviteSheet';
import { ServerCard } from './ServerCard';
import { useInvite, useServerReport } from './useSettingsData';

/** Development builds only (the dev seed's screenshots): open a sheet or scroll without a touch. */
export interface GroupSettingsDev {
  /** Content offset in points, as if scrolled. */
  scrollY?: number;
  open?: 'regenerate' | 'rename' | 'rename-group' | 'add' | 'move' | 'leave' | 'avatar';
  /** Show the old copy's delete, as after a move from this server (`https://…`). */
  movedFrom?: string;
  /** The member a sheet is about (by name): Rename, Avatar, or the one to remove when regenerating. */
  member?: string;
  /** Typed into Rename / Add member / Move, then submitted. */
  value?: string;
}

export interface GroupSettingsScreenProps {
  localId: string;
  dev?: GroupSettingsDev;
}

type Prompt = { kind: 'rename'; member: MemberState } | { kind: 'renameGroup' };

export function GroupSettingsScreen({ localId, dev }: GroupSettingsScreenProps) {
  const { groups } = useApp();
  const snapshot = useGroup(localId);
  const derived = snapshot.derived;
  const invite = useInvite(localId, derived);
  const report = useServerReport(localId, derived);
  const [oldServer, setOldServer] = useState<string | null>(
    () => movedFromOf(localId) ?? (__DEV__ ? (dev?.movedFrom ?? null) : null),
  );
  const [oldRetention, setOldRetention] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
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
    void Clipboard.setStringAsync(invite.code);
  };

  const shareLink = () => {
    if (invite === null) return;
    void Share.share({ url: invite.link });
  };

  // The old server's retention, for "The old copy expires on its own after 365 days".
  useEffect(() => {
    if (oldServer === null) return;
    let live = true;
    void groups.serverInfo(oldServer).then((info) => {
      if (live) setOldRetention(info?.retention_days ?? null);
    });
    return () => {
      live = false;
    };
  }, [groups, oldServer]);

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
      } else {
        await groups.renameGroup(localId, value);
      }
      setPromptOpen(false);
    } catch (error) {
      setPromptError(errorMessage(error, prompt.kind === 'rename' ? value : undefined));
    } finally {
      setPromptBusy(false);
    }
  };

  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [addBusy, setAddBusy] = useState(false);
  const addMember = async (name: string, emoji: string | null, id: string) => {
    setAddBusy(true);
    try {
      await groups.addMember(localId, name, emoji ?? undefined, { id });
      setAddOpen(false);
    } catch (error) {
      setAddError(errorMessage(error, name));
    } finally {
      setAddBusy(false);
    }
  };

  /** Move server's "Move": the problem to show under the field, or null once moved. */
  const moveTo = async (serverUrl: string): Promise<string | null> => {
    try {
      const result = await groups.moveServer(localId, serverUrl);
      const problem = moveFailure(result, hostOf(result.fromServer));
      if (problem !== null) return problem;
      rememberMove(localId, result.fromServer);
      setOldServer(result.fromServer);
      setMoveOpen(false);
      return null;
    } catch (error) {
      return errorMessage(error);
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
      } else if (open === 'rename-group') {
        setPrompt({ kind: 'renameGroup' });
        setPromptOpen(true);
      } else if (open === 'add') {
        setAddOpen(true);
      } else if (open === 'move') {
        setMoveOpen(true);
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
          <NameRow
            name={name}
            onPress={
              frozen || readOnly === 'archived'
                ? undefined
                : () => openPrompt({ kind: 'renameGroup' })
            }
          />
          <SectionHeader variant="settings">Invite</SectionHeader>
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
                onAdd={() => {
                  setAddError(undefined);
                  setAddOpen(true);
                }}
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
            oldRetentionDays={oldRetention}
            readOnly={frozen}
            onMove={() => setMoveOpen(true)}
            onDeleteOldCopy={deleteOldCopy}
            onExportGroupFile={exportGroupFile}
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
        title={prompt?.kind === 'renameGroup' ? 'Rename group' : 'Rename'}
        submitLabel="Save"
        variant={prompt?.kind === 'renameGroup' ? 'large' : 'row'}
        hint={
          prompt?.kind === 'renameGroup'
            ? `Everyone in the group sees the new name. Up to ${LIMITS.groupNameMax} characters.`
            : undefined
        }
        maxLength={prompt?.kind === 'renameGroup' ? LIMITS.groupNameMax : LIMITS.nameMax}
        initialValue={prompt?.kind === 'rename' ? prompt.member.name : name}
        draft={
          __DEV__ && dev?.value !== undefined && dev.open !== 'move' && dev.open !== 'add'
            ? dev.value
            : undefined
        }
        error={promptError}
        busy={promptBusy}
        onEdit={() => setPromptError(undefined)}
        onSubmit={(value) => void submitPrompt(value)}
        onDismiss={closePrompt}
      />
      <AddMemberSheet
        visible={addOpen}
        error={addError}
        busy={addBusy}
        initialName={__DEV__ && dev?.open === 'add' ? dev.value : undefined}
        onEdit={() => setAddError(undefined)}
        onAdd={(value, emoji, id) => void addMember(value, emoji, id)}
        onDismiss={() => {
          if (!addBusy) setAddOpen(false);
        }}
      />
      {derived !== null && (
        <MoveServerSheet
          visible={moveOpen}
          localId={localId}
          groupName={name}
          serverUrl={derived.row.serverUrl}
          onMove={moveTo}
          onDismiss={() => setMoveOpen(false)}
          initialValue={__DEV__ && dev?.open === 'move' ? dev.value : undefined}
          checkOnOpen={__DEV__ && dev?.open === 'move' && dev.value !== undefined}
        />
      )}
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

/**
 * The group's name at the top (GroupSettings: "Name · Banff 2026 ›"): its own card 16 below the nav bar, the label
 * 80 wide in `textSecondary`, the name right-aligned on one line, a chevron; opens Rename group.
 */
function NameRow({ name, onPress }: { name: string; onPress: (() => void) | undefined }) {
  const { tokens } = useTheme();
  return (
    <Card radius="group" style={styles.nameCard}>
      <ListRow
        title={
          <View style={styles.nameRow}>
            <AppText variant="callout" color="textSecondary" style={styles.nameLabel}>
              Name
            </AppText>
            <AppText variant="callout" numberOfLines={1} align="right" style={styles.nameValue}>
              {name}
            </AppText>
          </View>
        }
        trailing={
          onPress === undefined ? undefined : (
            <Icon name="chevronRight" size={16} color={tokens.iconMuted} />
          )
        }
        onPress={onPress}
        accessibilityLabel={`Group name: ${name}.${onPress === undefined ? '' : ' Rename.'}`}
      />
    </Card>
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
  nameCard: { marginTop: 16, marginHorizontal: layout.gutter, borderRadius: radii.group },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameLabel: { width: 80, flexShrink: 0 },
  nameValue: { flex: 1, minWidth: 0 },
});
