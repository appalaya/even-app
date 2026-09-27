import type { MemberState } from '@even/core';
import { StyleSheet, View } from 'react-native';

import {
  AddAvatar,
  AppText,
  Avatar,
  Button,
  Card,
  JoinedMark,
  ListRow,
  Strong,
} from '@/components';
import { layout } from '@/theme';

import type { MemberAction, MemberRow } from './model';

const LABEL: Record<MemberAction, string> = {
  rename: 'Rename',
  avatar: 'Avatar',
  archive: 'Archive',
  unarchive: 'Unarchive',
};

export interface MembersCardProps {
  rows: readonly MemberRow[];
  /** Read-only group (archived, rotated away): no pills, no "Add member". */
  readOnly: boolean;
  onAction: (action: MemberAction, member: MemberState) => void;
  onAdd: () => void;
}

/**
 * Group settings → Members (GroupSettings board): a 36 pt avatar, the name (16/21 medium, "(you)" regular muted)
 * over the joined line, then the pills this device may use on that member, 36 tall padded 14, 8 apart, inset 64
 * under the name; 1 pt separators inset 64; "Add member" last behind the dashed accent circle. An archived member
 * (extra states) sorts last, greyed: the avatar at 40 %, the name `textMuted`, "archived · still in past expenses",
 * and "Unarchive" in the accent.
 */
export function MembersCard({ rows, readOnly, onAction, onAdd }: MembersCardProps) {
  return (
    <Card radius="group" separatorInset={64} style={styles.card} accessibilityLabel="Members">
      {rows.map((row) => (
        <MemberBlock key={row.member.id} row={row} readOnly={readOnly} onAction={onAction} />
      ))}
      {!readOnly && (
        <ListRow
          variant="member"
          leading={<AddAvatar />}
          title="Add member"
          titleColor="accent"
          minHeight={56}
          paddingRight={16}
          onPress={onAdd}
        />
      )}
    </Card>
  );
}

function MemberBlock({
  row,
  readOnly,
  onAction,
}: {
  row: MemberRow;
  readOnly: boolean;
  onAction: (action: MemberAction, member: MemberState) => void;
}) {
  const { member, isMe, status } = row;
  const actions = readOnly ? [] : row.actions;
  const who = isMe ? 'you' : member.name;
  const archived = member.archived && !isMe;
  return (
    <View>
      <ListRow
        variant="member"
        leading={
          <Avatar
            size={36}
            name={member.name}
            initials={member.initials}
            emoji={member.emoji}
            color={member.color}
            dimmed={archived}
          />
        }
        title={
          isMe ? (
            <AppText variant="callout" weight="medium">
              {member.name}{' '}
              <Strong weight="regular" color="textMuted">
                (you)
              </Strong>
            </AppText>
          ) : (
            member.name
          )
        }
        titleColor={archived ? 'textMuted' : 'text'}
        subtitle={status.joined ? <JoinedMark label={status.label} /> : status.label}
      />
      {actions.length > 0 && (
        <View style={styles.actions} accessibilityLabel={`Actions for ${who}`}>
          {actions.map((action) => (
            <Button
              key={action}
              label={LABEL[action]}
              size="pillNarrow"
              variant="neutral"
              weight={action === 'unarchive' ? 'semibold' : 'medium'}
              {...(action === 'unarchive' ? { labelColor: 'accent' as const } : {})}
              accessibilityLabel={`${LABEL[action]} ${who === 'you' ? 'yourself' : who}`}
              onPress={() => onAction(action, member)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: layout.gutter },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingLeft: 64,
    paddingRight: 16,
    paddingBottom: 14,
  },
});
