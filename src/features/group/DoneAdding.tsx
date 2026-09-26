import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  Avatar,
  AvatarStack,
  AVATAR_STACK_MAX,
  Button,
  Card,
  JoinedMark,
  ListRow,
  SectionHeader,
  Sheet,
  Strong,
  type StackMember,
} from '@/components';
import { layout, useTheme } from '@/theme';

import type { DonePerson, DoneSummary } from './model';

function stackMember(p: DonePerson): StackMember {
  const m = p.member;
  return {
    id: m.id,
    name: m.name,
    initials: m.initials,
    color: m.color,
    done: p.done,
    ...(m.emoji === undefined ? {} : { emoji: m.emoji }),
  };
}

/** "3 of 4 done adding", or "Everyone's done" once `allDone`. */
export function doneLabel(summary: DoneSummary): string {
  return summary.allDone
    ? "Everyone's done"
    : `${summary.doneCount} of ${summary.total} done adding`;
}

/**
 * The done-adding row under the header. Up to five members (Group): 28 pt avatars, 12 apart, 56 tall. More (Group ·
 * twelve members): 26 pt avatars and the "+N" chip, 10 apart, 60 tall, the pill padded 14. The avatars and label open
 * the Done adding sheet; the pill toggles your own mark ("I'm done" / "Add more").
 */
export function DoneRow({
  summary,
  onOpen,
  onToggle,
}: {
  summary: DoneSummary;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const many = summary.people.length > AVATAR_STACK_MAX;
  const label = doneLabel(summary);
  return (
    <Card radius="group" style={[styles.row, many && styles.rowMany]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Show everyone.`}
        style={({ pressed }) => [styles.open, many && styles.openMany, pressed && styles.pressed]}
      >
        <AvatarStack members={summary.people.map(stackMember)} size={many ? 26 : 28} />
        <AppText variant="subhead" style={styles.label}>
          {label}
        </AppText>
      </Pressable>
      <DoneToggle meDone={summary.meDone} size="pill" many={many} onPress={onToggle} />
    </Card>
  );
}

function DoneToggle({
  meDone,
  size,
  many = false,
  onPress,
}: {
  meDone: boolean;
  size: 'pill' | 'mini';
  many?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      label={meDone ? 'Add more' : "I'm done"}
      variant={meDone ? 'neutral' : 'secondary'}
      size={size}
      selected={meDone}
      haptic="impact"
      onPress={onPress}
      style={many ? styles.pillMany : undefined}
    />
  );
}

/**
 * Done adding (sheet, 130 from the top): "Done adding · 7 of 12", then "Still adding · 5" and "Done · 7" as inset
 * lists of 30 pt avatars. Your row carries the toggle; everyone else's says "still adding" or "✓ done".
 */
export function DoneSheet({
  visible,
  summary,
  onDismiss,
  onToggle,
}: {
  visible: boolean;
  summary: DoneSummary;
  onDismiss: () => void;
  onToggle: () => void;
}) {
  const still = summary.people.filter((p) => !p.done);
  const done = summary.people.filter((p) => p.done);
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      top={130}
      accessibilityLabel="Done adding"
      title={
        <AppText variant="headline" accessibilityRole="header">
          Done adding{' '}
          <Strong weight="regular" color="textMuted">
            {`· ${summary.doneCount} of ${summary.total}`}
          </Strong>
        </AppText>
      }
      onClose={onDismiss}
    >
      <ScrollView style={styles.sheetScroll}>
        {still.length > 0 && (
          <>
            <SectionHeader variant="settings" spacingTop={10}>
              {`Still adding · ${still.length}`}
            </SectionHeader>
            <PeopleList people={still} onToggle={onToggle} />
          </>
        )}
        {done.length > 0 && (
          <>
            <SectionHeader variant="settings" spacingTop={still.length > 0 ? 16 : 10}>
              {`Done · ${done.length}`}
            </SectionHeader>
            <PeopleList people={done} onToggle={onToggle} />
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

function PeopleList({ people, onToggle }: { people: DonePerson[]; onToggle: () => void }) {
  return (
    <View style={styles.gutter}>
      <Card tone="inset" radius="group" separatorInset={56}>
        {people.map((p) => (
          <PersonRow key={p.member.id} person={p} onToggle={onToggle} />
        ))}
      </Card>
    </View>
  );
}

function PersonRow({ person, onToggle }: { person: DonePerson; onToggle: () => void }) {
  const { tokens } = useTheme();
  const m = person.member;
  const avatar = (
    <Avatar
      size={30}
      name={m.name}
      initials={m.initials}
      color={m.color}
      on="inset"
      outlined={!person.done}
      backdrop={person.done ? undefined : tokens.surfaceInset}
      {...(m.emoji === undefined || !person.done ? {} : { emoji: m.emoji })}
    />
  );
  if (person.isMe) {
    return (
      <ListRow
        variant="person"
        leading={avatar}
        title="You"
        titleWeight="medium"
        paddingRight={8}
        trailing={<DoneToggle meDone={person.done} size="mini" onPress={onToggle} />}
      />
    );
  }
  return (
    <ListRow
      variant="person"
      leading={avatar}
      title={m.name}
      trailing={
        person.done ? (
          <JoinedMark label="done" />
        ) : (
          <AppText variant="caption" color="textMuted">
            still adding
          </AppText>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: 12,
    marginHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingLeft: 14,
    paddingRight: 10,
  },
  rowMany: { gap: 10, minHeight: 60 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  openMany: { gap: 10, paddingVertical: 8 },
  label: { flexShrink: 1 },
  pillMany: { paddingHorizontal: 14 },
  pressed: { opacity: 0.6 },
  sheetScroll: { flexGrow: 0 },
  gutter: { marginHorizontal: layout.gutter },
});
