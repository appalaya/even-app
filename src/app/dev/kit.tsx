import type { Category } from '@even/core';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LogBox, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';

import {
  AddAvatar,
  AmountDisplay,
  AppText,
  Avatar,
  AvatarStack,
  Banner,
  Button,
  Card,
  CategoryBars,
  CategoryChip,
  CategoryGrid,
  CategoryTile,
  EmptyStateMark,
  FieldLabel,
  Footnote,
  HeaderButton,
  JoinedMark,
  Keypad,
  ListRow,
  Mark,
  MemberChip,
  MoneyText,
  Screen,
  SearchField,
  SectionHeader,
  SegmentedControl,
  SelectPill,
  Sheet,
  SheetPanel,
  StatusLine,
  Strong,
  SyncDot,
  TextField,
  ToggleRow,
  Wordmark,
  type StackMember,
} from '@/components';
import {
  ThemeProvider,
  layout,
  typography,
  useTheme,
  type AppearancePreference,
  type ThemeTokens,
  type TypographyVariant,
} from '@/theme';

/**
 * Dev-only kit gallery: every component in every state, in either scheme, to compare against the canvas boards.
 * Reached by long-pressing the wordmark on Groups in a development build; production builds redirect home.
 *
 * Parameters: `section` (one section), `scheme` (light | dark), `sheet=1` (open the modal sheet), `tour=1` (the
 * screenshot tour below), e.g. `even://dev/kit?section=buttons&scheme=dark`.
 */
export default function KitRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <KitGallery />;
}

// Board data: CAD in en-CA so figures read "$52.00" as drawn (en-US would print "CA$52.00").
const CUR = 'CAD';
const LOC = 'en-CA';

const SECTIONS = [
  { key: 'type', label: 'Type' },
  { key: 'colors', label: 'Colours' },
  { key: 'buttons', label: 'Buttons' },
  { key: 'avatars', label: 'Avatars' },
  { key: 'status', label: 'Money · status · banners' },
  { key: 'lists', label: 'Lists' },
  { key: 'more-lists', label: 'More lists' },
  { key: 'controls', label: 'Controls' },
  { key: 'fields', label: 'Fields' },
  { key: 'entry', label: 'Amount entry' },
  { key: 'categories', label: 'Categories' },
  { key: 'sheets', label: 'Sheets' },
  { key: 'brand', label: 'Brand' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

function KitGallery() {
  const params = useLocalSearchParams<{
    section?: string;
    scheme?: string;
    sheet?: string;
    tour?: string;
  }>();
  const initialScheme: AppearancePreference =
    params.scheme === 'dark' || params.scheme === 'light' ? params.scheme : 'system';
  const [appearance, setAppearance] = useState<AppearancePreference>(initialScheme);
  const chosen = SECTIONS.find((s) => s.key === params.section)?.key;
  const tour = useTour(params.tour === '1');

  return (
    <ThemeProvider appearance={tour.active ? tour.scheme : appearance}>
      <KitScreen
        appearance={tour.active ? tour.scheme : appearance}
        onAppearance={setAppearance}
        only={tour.active ? tour.section : chosen}
        sheetOpen={params.sheet === '1'}
        scrollY={tour.active ? tour.scrollY : undefined}
        caption={tour.active ? tour.caption : undefined}
        onMeasure={tour.onMeasure}
      />
    </ThemeProvider>
  );
}

/**
 * Screenshot tour (`?tour=1`): steps through every section, a screenful at a time, in light and then dark, one
 * step every 3 s, so `xcrun simctl io booted screenshot` can capture the whole kit without touch input. The nav
 * title names the step ("buttons 1/2 · light").
 */
function useTour(active: boolean) {
  const [step, setStep] = useState({ scheme: 0, section: 0, page: 0, y: 0 });
  const current = useRef(step);
  const size = useRef({ content: 0, viewport: 1 });
  useEffect(() => {
    if (!active) return;
    LogBox.ignoreAllLogs(true);
    const timer = setInterval(() => {
      const cur = current.current;
      const pageStep = Math.max(1, size.current.viewport - 48);
      const pages = Math.max(1, Math.ceil((size.current.content - 48) / pageStep));
      let next = cur;
      if (cur.page + 1 < pages) next = { ...cur, page: cur.page + 1, y: (cur.page + 1) * pageStep };
      else if (cur.section + 1 < SECTIONS.length)
        next = { ...cur, section: cur.section + 1, page: 0, y: 0 };
      else if (cur.scheme === 0) next = { scheme: 1, section: 0, page: 0, y: 0 };
      else clearInterval(timer);
      current.current = next;
      setStep(next);
    }, 3000);
    return () => clearInterval(timer);
  }, [active]);
  const section = SECTIONS[step.section]?.key ?? 'type';
  const scheme: AppearancePreference = step.scheme === 0 ? 'light' : 'dark';
  return {
    active,
    section,
    scheme,
    scrollY: step.y,
    caption: `${section} ${step.page + 1} · ${scheme}`,
    onMeasure: (content: number, viewport: number) => {
      size.current = { content, viewport };
    },
  };
}

function KitScreen({
  appearance,
  onAppearance,
  only,
  sheetOpen,
  scrollY,
  caption,
  onMeasure,
}: {
  appearance: AppearancePreference;
  onAppearance: (a: AppearancePreference) => void;
  only?: SectionKey;
  sheetOpen: boolean;
  scrollY?: number;
  caption?: string;
  onMeasure: (content: number, viewport: number) => void;
}) {
  const { scheme } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const measured = useRef({ content: 0, viewport: 0 });
  useEffect(() => {
    if (scrollY !== undefined) scroll.current?.scrollTo({ y: scrollY, animated: false });
  }, [scrollY, only]);
  const show = (key: SectionKey) => only === undefined || only === key;
  return (
    <Screen
      back={{ label: 'Groups', onPress: () => router.back() }}
      title={caption ?? (only === undefined ? 'Kit' : SECTIONS.find((s) => s.key === only)?.label)}
      scroll={false}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        onLayout={(e) => {
          measured.current.viewport = e.nativeEvent.layout.height;
          onMeasure(measured.current.content, measured.current.viewport);
        }}
        onContentSizeChange={(_, h) => {
          measured.current.content = h;
          onMeasure(measured.current.content, measured.current.viewport);
        }}
      >
        <View style={styles.schemeRow}>
          <SegmentedControl
            size="compact"
            accessibilityLabel="Appearance"
            segments={[
              { key: 'system', label: 'System' },
              { key: 'light', label: 'Light' },
              { key: 'dark', label: 'Dark' },
            ]}
            value={appearance}
            onChange={onAppearance}
          />
        </View>
        {show('type') && <TypeSection />}
        {show('colors') && <ColorSection />}
        {show('buttons') && <ButtonSection />}
        {show('avatars') && <AvatarSection />}
        {show('status') && <StatusSection />}
        {show('lists') && <ListSection />}
        {show('more-lists') && <MoreListSection />}
        {show('controls') && <ControlSection />}
        {show('fields') && <FieldSection />}
        {show('entry') && <EntrySection />}
        {show('categories') && <CategorySection />}
        {show('sheets') && <SheetSection startOpen={sheetOpen} />}
        {show('brand') && <BrandSection />}
      </ScrollView>
    </Screen>
  );
}

// ---------- Helpers ----------

/** A gallery heading (dev chrome, not a kit component). */
function Title({ children }: { children: ReactNode }) {
  return <SectionHeader variant="title">{children}</SectionHeader>;
}

/** A small dev caption naming the state shown under it. */
function Note({ children }: { children: ReactNode }) {
  return (
    <AppText variant="caption" color="textMuted" style={styles.note}>
      {children}
    </AppText>
  );
}

function Gutter({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return <View style={[styles.gutter, { gap }]}>{children}</View>;
}

function Row({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return <View style={[styles.row, { gap }]}>{children}</View>;
}

const MEMBERS = {
  you: { id: 'you', name: 'Sam', initials: 'S', color: 9 },
  maya: { id: 'maya', name: 'Maya', initials: 'M', color: 0 },
  jordan: { id: 'jordan', name: 'Jordan', emoji: '🏂' },
  nathan: { id: 'nathan', name: 'Nathan', initials: 'N', color: 7 },
  priya: { id: 'priya', name: 'Priya', initials: 'P', color: 11 },
} as const;

// ---------- Sections ----------

function TypeSection() {
  const variants = Object.keys(typography) as TypographyVariant[];
  return (
    <>
      <Title>Type scale</Title>
      <Gutter gap={6}>
        {variants.map((v) => (
          <View key={v} style={styles.typeRow}>
            <AppText variant="caption" color="textMuted" style={styles.typeName}>
              {`${v} ${typography[v].fontSize}/${typography[v].lineHeight}`}
            </AppText>
            <AppText variant={v} numberOfLines={1} style={styles.flex}>
              {v === 'display' || v === 'amount' ? '$52.00' : 'Banff 2026'}
            </AppText>
          </View>
        ))}
      </Gutter>
    </>
  );
}

function ColorSection() {
  const { tokens } = useTheme();
  const names = (Object.keys(tokens) as (keyof ThemeTokens)[]).filter((k) => k !== 'avatar');
  return (
    <>
      <Title>Colour tokens</Title>
      <Gutter gap={4}>
        {names.map((n) => (
          <View key={n} style={styles.swatchRow}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: tokens[n] as string, borderColor: tokens.border },
              ]}
            />
            <AppText variant="caption" style={styles.flex}>
              {n}
            </AppText>
            <AppText variant="caption" color="textMuted" tabular>
              {tokens[n] as string}
            </AppText>
          </View>
        ))}
      </Gutter>
      <Note>Avatar palette 0–11 (clay … rose)</Note>
      <Gutter>
        <Row gap={6}>
          {tokens.avatar.map((_, i) => (
            <Avatar key={i} size={26} initials={`${i}`} color={i} />
          ))}
        </Row>
      </Gutter>
    </>
  );
}

function ButtonSection() {
  return (
    <>
      <Title>Buttons</Title>
      <Gutter>
        <Note>Groups footer: secondary + primary, 52</Note>
        <Row>
          <Button label="Join with code" variant="secondary" style={styles.flex} />
          <Button label="Create group" style={styles.flex} />
        </Row>
        <Note>Group footer: primary with plus</Note>
        <Button label="Add expense" icon="plus" haptic="impact" />
        <Note>Invite card: medium 48</Note>
        <Row>
          <Button label="Share link" size="medium" style={styles.flex} />
          <Button label="Copy code" size="medium" variant="secondary" style={styles.flex} />
        </Row>
        <Note>Group settings: small 44 · disabled (preparing)</Note>
        <Row>
          <Button label="Copy code" size="small" variant="secondary" style={styles.flex} />
          <Button label="Share link" size="small" disabled style={styles.flex} />
        </Row>
        <Note>Pill 36 (done row) · mini 32 (done sheet) · neutral pill</Note>
        <Row>
          <Button label="I'm done" size="pill" variant="secondary" selected={false} />
          <Button label="Add more" size="pill" variant="neutral" selected />
          <Button label="I'm done" size="mini" variant="secondary" />
        </Row>
        <Note>Neutral 52 · with leading avatar · disabled 52 (Join)</Note>
        <Button label="Cancel" variant="neutral" />
        <Button
          label="Use initials"
          variant="neutral"
          leading={<Avatar size={28} initials="S" color={9} />}
        />
        <Button label="Join" disabled />
        <Note>Quiet: Cancel (regular) · Done (semibold) · Done disabled · Details</Note>
        <Row>
          <Button label="Cancel" variant="quiet" />
          <Button label="Done" variant="quiet" weight="semibold" />
          <Button label="Done" variant="quiet" weight="semibold" disabled />
          <Button label="Details" variant="quiet" size="pill" />
        </Row>
      </Gutter>
    </>
  );
}

function AvatarSection() {
  const { tokens } = useTheme();
  const group: StackMember[] = [
    { ...MEMBERS.maya, done: true },
    { ...MEMBERS.jordan, done: true },
    { ...MEMBERS.nathan, done: true },
    { ...MEMBERS.you, done: false },
  ];
  const many: StackMember[] = [
    { ...MEMBERS.you, done: false },
    { ...MEMBERS.priya, done: false },
    { id: 'leo', initials: 'L', done: false },
    { id: 'ben', initials: 'B', done: false },
    { id: 'diego', initials: 'D', done: false },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, initials: 'X', color: i, done: true })),
  ];
  const fresh: StackMember[] = [
    { ...MEMBERS.you, done: true },
    { ...MEMBERS.maya, done: true },
    { id: 'j', initials: 'J', color: 2, done: true },
    { ...MEMBERS.nathan, done: true },
  ];
  return (
    <>
      <Title>Avatars</Title>
      <Gutter>
        <Note>Initials at 24 · 26 · 28 · 30 · 32 · 36 · 72</Note>
        <Row gap={8}>
          {([24, 26, 28, 30, 32, 36] as const).map((s) => (
            <Avatar key={s} size={s} initials="M" color={0} />
          ))}
          <Avatar size={72} initials="S" color={9} />
        </Row>
        <Note>Emoji on surface · on inset/fill list · outlined (still adding) · dimmed</Note>
        <Row gap={8}>
          {([28, 30, 32, 36] as const).map((s) => (
            <Avatar key={s} size={s} emoji="🏂" />
          ))}
          <Avatar size={32} emoji="🏂" on="inset" />
          <Avatar size={30} initials="S" outlined />
          <Avatar size={32} initials="N" color={7} dimmed />
        </Row>
        <Note>You card: pencil badge (initials on surface; emoji on surface; emoji on fill)</Note>
        <Row gap={24}>
          <Avatar size={72} initials="S" color={9} badge="pencil" />
          <Avatar size={72} emoji="🌲" badge="pencil" />
          <View style={[styles.fillBox, { backgroundColor: tokens.fill }]}>
            <Avatar size={72} emoji="🌲" on="fill" badge="pencil" badgeRing={tokens.fill} />
          </View>
        </Row>
        <Note>Add member · joined marks</Note>
        <Row gap={16}>
          <AddAvatar />
          <JoinedMark />
          <JoinedMark label="joined · this phone" />
          <JoinedMark label="joined" size={13} />
        </Row>
        <Note>Done-adding row, 4 members (3 of 4)</Note>
        <Card radius="group" style={styles.doneRow}>
          <AvatarStack members={group} />
          <AppText variant="subhead" style={styles.flex}>
            3 of 4 done adding
          </AppText>
          <Button label="I'm done" size="pill" variant="secondary" />
        </Card>
        <Note>12 members: five, then +7 (26 pt)</Note>
        <Card radius="group" style={[styles.doneRow, styles.doneRowMany]}>
          <AvatarStack members={many} size={26} />
          <AppText variant="subhead" style={styles.flex}>
            7 of 12 done adding
          </AppText>
          <Button label="I'm done" size="pill" variant="secondary" />
        </Card>
        <Note>New group: 24 pt on the canvas</Note>
        <Row>
          <AvatarStack members={fresh} size={24} ringColor={tokens.background} />
          <AppText variant="caption" color="textMuted">
            4 people · nobody else has joined yet
          </AppText>
        </Row>
      </Gutter>
    </>
  );
}

function StatusSection() {
  return (
    <>
      <Title>Money</Title>
      <Gutter gap={6}>
        <AppText variant="body" color="textSecondary">
          You owe
        </AppText>
        <MoneyText amount={5200} currency={CUR} locale={LOC} size="big" />
        <StatusLine state="synced" label="Synced 2 min ago" onSyncNow={() => {}} />
        <StatusLine state="syncing" label="Syncing…" />
        <StatusLine state="stale" label="Not synced since 9:41" onSyncNow={() => {}} />
        <Note>Inline: 16 semibold · 16 medium · 17 semibold · 15 medium</Note>
        <Row gap={16}>
          <MoneyText amount={4400} currency={CUR} locale={LOC} />
          <MoneyText amount={118000} currency={CUR} locale={LOC} weight="medium" />
          <MoneyText amount={5200} currency={CUR} locale={LOC} variant="body" />
          <MoneyText amount={42000} currency={CUR} locale={LOC} variant="subhead" weight="medium" />
        </Row>
        <Note>Sync dots on Groups: synced · waiting</Note>
        <Row gap={16}>
          <SyncDot />
          <SyncDot waiting />
        </Row>
      </Gutter>
      <Title>Banners</Title>
      <Gutter gap={8}>
        <Banner variant="unreadable" message="2 entries couldn't be read" actionLabel="Details" />
        <Banner variant="archived" message="Archived · read-only" actionLabel="Unarchive" />
        <Note>Not on the canvas (anatomy reused; copy provisional)</Note>
        <Banner variant="updateRequired" message="Update Even to see new entries" />
        <Banner variant="closed" message="This group was closed" />
        <Banner variant="moved" message="This group moved to a new link" actionLabel="Details" />
      </Gutter>
    </>
  );
}

function ListSection() {
  return (
    <>
      <Title>Expense rows (Group)</Title>
      <Gutter>
        <Card separatorInset={68}>
          <ListRow
            variant="expense"
            leading={<CategoryTile emoji="🍽️" />}
            title="Dinner at Park Distillery"
            subtitle="Maya paid"
            detail={<MoneyText amount={9600} currency={CUR} locale={LOC} weight="medium" />}
            detailCaption="Sep 20"
            onPress={() => {}}
          />
          <ListRow
            variant="expense"
            leading={<CategoryTile emoji="🏨" />}
            title="Fairmont Banff Springs"
            subtitle="You paid"
            detail={<MoneyText amount={118000} currency={CUR} locale={LOC} weight="medium" />}
            detailCaption="Sep 18"
            onPress={() => {}}
          />
        </Card>
        <Note>Settle list · then tinted once everyone is done</Note>
        <Card separatorInset={60}>
          <ListRow
            variant="settle"
            leading={<Avatar size={32} initials="M" color={0} />}
            title="You pay Maya"
            detail={<MoneyText amount={4400} currency={CUR} locale={LOC} />}
            chevron
            onPress={() => {}}
          />
          <ListRow
            variant="settle"
            leading={<Avatar size={32} emoji="🏂" />}
            title="You pay Jordan"
            detail={<MoneyText amount={800} currency={CUR} locale={LOC} />}
            chevron
            onPress={() => {}}
          />
        </Card>
        <Card tone="tint">
          <ListRow
            variant="settle"
            leading={<Avatar size={32} initials="M" color={0} />}
            title="You pay Maya"
            detail={<MoneyText amount={4400} currency={CUR} locale={LOC} />}
            chevron="accent"
            onPress={() => {}}
          />
        </Card>
        <Note>Balances</Note>
        <Card separatorInset={60}>
          <ListRow
            variant="balance"
            leading={<Avatar size={32} initials="S" color={9} />}
            title={
              <AppText variant="callout">
                <Strong>You</Strong> owe
              </AppText>
            }
            detail={<MoneyText amount={5200} currency={CUR} locale={LOC} />}
          />
          <ListRow
            variant="balance"
            leading={<Avatar size={32} initials="M" color={0} />}
            title={
              <AppText variant="callout">
                <Strong>Maya</Strong> is owed
              </AppText>
            }
            detail={<MoneyText amount={17200} currency={CUR} locale={LOC} />}
          />
        </Card>
        <Note>Activity</Note>
        <Card separatorInset={60}>
          <ListRow
            variant="activity"
            leading={<Avatar size={32} initials="M" color={0} />}
            title={
              <AppText variant="subheadLoose">
                <Strong>Maya</Strong> is done adding expenses
              </AppText>
            }
            subtitle="9:50 AM"
          />
          <ListRow
            variant="activity"
            leading={<Avatar size={32} initials="M" color={0} />}
            title={
              <AppText variant="subheadLoose" tabular>
                <Strong>Maya</Strong> changed Nathan&apos;s lift tickets from $400.00 to $420.00
              </AppText>
            }
            subtitle="9:12 AM"
          />
        </Card>
      </Gutter>
    </>
  );
}

function MoreListSection() {
  return (
    <>
      <SectionHeader variant="settings" spacingTop={16}>
        Members
      </SectionHeader>
      <Gutter>
        <Card radius="group" separatorInset={64}>
          <ListRow
            variant="member"
            leading={<Avatar size={36} initials="S" color={9} />}
            title={
              <AppText variant="callout" weight="medium">
                Sam{' '}
                <Strong weight="regular" color="textMuted">
                  (you)
                </Strong>
              </AppText>
            }
            subtitle={<JoinedMark label="joined · this phone" />}
          />
          <ListRow
            variant="member"
            leading={<Avatar size={36} initials="N" color={7} />}
            title="Nathan"
            subtitle="not joined yet"
          />
          <ListRow
            variant="member"
            leading={<AddAvatar />}
            title="Add member"
            titleColor="accent"
            minHeight={56}
            onPress={() => {}}
          />
        </Card>
      </Gutter>
      <Footnote>
        You can edit your own name and avatar. Anyone can archive a member who&apos;s left.
      </Footnote>
      <SectionHeader variant="settings">About</SectionHeader>
      <Gutter>
        <Card radius="group" separatorInset={16}>
          <ListRow title="Privacy" chevron minHeight={48} onPress={() => {}} />
          <ListRow
            title="Move to another server"
            titleColor="accent"
            titleWeight="medium"
            chevron="accent"
            onPress={() => {}}
          />
          <ListRow title="Version" detail="1.0 (1)" minHeight={48} />
        </Card>
      </Gutter>
      <SectionHeader variant="settings" spacingTop={16}>
        Still adding · 2
      </SectionHeader>
      <Gutter>
        <Card tone="inset" radius="group" separatorInset={56}>
          <ListRow
            variant="person"
            leading={<Avatar size={30} initials="S" outlined />}
            title="You"
            paddingRight={8}
            trailing={<Button label="I'm done" size="mini" variant="secondary" />}
          />
          <ListRow
            variant="person"
            leading={<Avatar size={30} initials="P" outlined />}
            title="Priya"
            trailing={
              <AppText variant="caption" color="textMuted">
                still adding
              </AppText>
            }
          />
          <ListRow
            variant="person"
            leading={<Avatar size={30} emoji="🏂" on="inset" />}
            title="Jordan"
            trailing={<JoinedMark label="done" />}
          />
        </Card>
        <Note>Join: which name is yours?</Note>
        <Card tone="inset" separatorInset={62}>
          <ListRow
            variant="choice"
            leading={<Avatar size={36} initials="M" color={0} />}
            title="Maya"
            trailing={<JoinedMark size={13} />}
            onPress={() => {}}
          />
          <ListRow
            variant="choice"
            leading={<Avatar size={36} initials="N" color={7} />}
            title="Nathan"
            chevron
            onPress={() => {}}
          />
        </Card>
      </Gutter>
    </>
  );
}

function ControlSection() {
  const [tab, setTab] = useState<'expenses' | 'balances' | 'activity'>('expenses');
  const [split, setSplit] = useState<'equal' | 'exact' | 'percent'>('exact');
  const [look, setLook] = useState<AppearancePreference>('system');
  const [notify, setNotify] = useState(true);
  const [nathan, setNathan] = useState(true);
  return (
    <>
      <Title>Segmented controls</Title>
      <Gutter>
        <SegmentedControl
          segments={[
            { key: 'expenses', label: 'Expenses' },
            { key: 'balances', label: 'Balances' },
            { key: 'activity', label: 'Activity' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <SegmentedControl
          segments={[
            { key: 'equal', label: 'Equal' },
            { key: 'exact', label: 'Exact' },
            { key: 'percent', label: 'Percent' },
          ]}
          value={split}
          onChange={setSplit}
        />
        <Card radius="group">
          <View style={styles.appearanceRow}>
            <AppText variant="callout" style={styles.flex}>
              Appearance
            </AppText>
            <SegmentedControl
              size="compact"
              accessibilityLabel="Appearance"
              segments={[
                { key: 'system', label: 'System' },
                { key: 'light', label: 'Light' },
                { key: 'dark', label: 'Dark' },
              ]}
              value={look}
              onChange={setLook}
            />
          </View>
        </Card>
        <Note>Toggle row: on · off (off track not drawn)</Note>
        <Card radius="group" separatorInset={16}>
          <ToggleRow label="Notifications" value={notify} onValueChange={setNotify} />
          <ToggleRow label="Notifications" value={!notify} onValueChange={(v) => setNotify(!v)} />
        </Card>
      </Gutter>
      <Title>Chips</Title>
      <Gutter>
        <Note>Category: suggested · chosen · choosing</Note>
        <Row gap={8}>
          <CategoryChip emoji="🚆" label="Transit" state="suggested" />
          <CategoryChip emoji="🍽️" label="Food" state="chosen" />
        </Row>
        <Row>
          <CategoryChip emoji="🏨" label="Lodging" state="choosing" />
        </Row>
        <Note>Members: removable · toggle off / on</Note>
        <Row gap={8}>
          <MemberChip name="Maya" initials="M" color={0} onRemove={() => {}} />
          <MemberChip name="Jordan" initials="J" color={2} onRemove={() => {}} />
        </Row>
        <Row gap={8}>
          <MemberChip name="Jordan" emoji="🏂" onToggle={() => {}} />
          <MemberChip
            name="Nathan"
            initials="N"
            color={7}
            selected={nathan}
            onToggle={() => setNathan(!nathan)}
          />
        </Row>
        <Note>Select pills</Note>
        <Row gap={8}>
          <SelectPill label="Paid by" value="You" />
          <SelectPill value="Today" />
        </Row>
      </Gutter>
    </>
  );
}

function FieldSection() {
  const [name, setName] = useState('Banff 2026');
  const [title, setTitle] = useState('Lake Louise shuttle');
  return (
    <>
      <Title>Fields</Title>
      <Gutter gap={16}>
        <TextField variant="large" label="Name" value={name} onChangeText={setName} />
        <TextField
          variant="title"
          accessibilityLabel="Title"
          value={title}
          onChangeText={setTitle}
          trailing={<CategoryChip emoji="🚆" label="Transit" state="suggested" />}
        />
        <TextField
          variant="row"
          label="People (optional)"
          placeholder="Add a name"
          onAdd={() => {}}
          helper="They'll pick their name when they join. You can add more later."
        />
        <View style={styles.gap6}>
          <FieldLabel>Your name</FieldLabel>
          <TextField variant="inline" accessibilityLabel="Your name" defaultValue="Sam" />
        </View>
        <TextField variant="pill" accessibilityLabel="Note" placeholder="Note (optional)" />
        <Note>Split cells: amount · active (keypad target) · percent</Note>
        <Card tone="fill" style={styles.cellRow}>
          <TextField variant="cell" width={100} defaultValue="$12.00" accessibilityLabel="You" />
          <TextField
            variant="cell"
            width={100}
            defaultValue="$6.00"
            active
            accessibilityLabel="Jordan"
          />
          <TextField variant="cell" width={76} defaultValue="15%" accessibilityLabel="Maya" />
        </Card>
        <SearchField placeholder="Search emoji" />
      </Gutter>
      <Title>Invite code</Title>
      <Gutter gap={16}>
        <TextField
          variant="code"
          placeholder="Paste a code or link"
          onPaste={() => {}}
          accessibilityLabel="Invite code"
        />
        <TextField
          variant="code"
          accessibilityLabel="Invite code"
          defaultValue="eyJ2IjoxLCJzIjoiaHR0cHM6Ly9zeW5jLmV2ZW4uYXBwYWxheWEuY29tIiwiayI6IkJ3Z0pDZ3NNRFE0UEVCRVNFeFFWRmhjWUdSb2JIQjBl"
          onPaste={() => {}}
          error="That code isn't complete. Copy it again."
        />
      </Gutter>
    </>
  );
}

function EntrySection() {
  const [minor, setMinor] = useState(3600);
  const onKey = (key: string) => {
    if (key === 'delete') setMinor((m) => Math.floor(m / 10));
    else if (key !== '.') setMinor((m) => Math.min(m * 10 + Number(key), 99_999_999));
  };
  return (
    <>
      <Title>Amount entry</Title>
      <Gutter gap={12}>
        <AmountDisplay amount={minor} currency={CUR} locale={LOC} />
        <Row gap={8}>
          <SelectPill label="Paid by" value="You" />
          <SelectPill value="Today" />
        </Row>
        <Button label="Save" haptic="success" />
        <Keypad onKey={onKey} />
        <Note>Keypad at 52 (Split, Settle), no decimal (JPY)</Note>
        <Keypad onKey={onKey} keyHeight={52} decimal={false} />
      </Gutter>
    </>
  );
}

function CategorySection() {
  const [picked, setPicked] = useState<Category>('lodging');
  return (
    <>
      <Title>Category picker</Title>
      <Gutter>
        <CategoryGrid value={picked} onChange={setPicked} />
      </Gutter>
      <Footnote align="center" spacingTop={8}>
        Your pick stays, even if you edit the title.
      </Footnote>
      <SectionHeader tabular spacingTop={24}>
        Spend by category · $1,780.00
      </SectionHeader>
      <Gutter>
        <Card>
          <CategoryBars
            currency={CUR}
            locale={LOC}
            rows={[
              { category: 'lodging', amount: 118000 },
              { category: 'activities', amount: 42000 },
              { category: 'food', amount: 9600 },
              { category: 'fuel', amount: 6000 },
              { category: 'parking', amount: 2400 },
            ]}
          />
        </Card>
      </Gutter>
    </>
  );
}

function SheetSection({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const { tokens } = useTheme();
  return (
    <>
      <Title>Sheet panels (inline)</Title>
      <View style={[styles.sheetStage, { backgroundColor: tokens.scrim }]}>
        <SheetPanel
          accessibilityLabel="Done adding"
          title={
            <AppText variant="headline">
              Done adding{' '}
              <Strong weight="regular" color="textMuted">
                · 7 of 12
              </Strong>
            </AppText>
          }
          onClose={() => {}}
        >
          <SectionHeader variant="settings" spacingTop={10}>
            Still adding · 1
          </SectionHeader>
          <Gutter>
            <Card tone="inset" radius="group">
              <ListRow
                variant="person"
                leading={<Avatar size={30} initials="P" outlined />}
                title="Priya"
                trailing={
                  <AppText variant="caption" color="textMuted">
                    still adding
                  </AppText>
                }
              />
            </Card>
          </Gutter>
        </SheetPanel>
      </View>
      <View style={[styles.sheetStage, { backgroundColor: tokens.scrim }]}>
        <SheetPanel
          accessibilityLabel="Split"
          bottom="keypad"
          leftAction={{ label: 'New expense', back: true, onPress: () => {} }}
          navTitle="Split"
          navTitleInset={150}
          rightAction={{ label: 'Done', disabled: true, onPress: () => {} }}
        >
          <AppText variant="subhead" color="textSecondary" align="center" tabular>
            Lake Louise shuttle · $36.00
          </AppText>
        </SheetPanel>
      </View>
      <View style={[styles.sheetStage, { backgroundColor: tokens.scrim }]}>
        <SheetPanel
          accessibilityLabel="Join with code"
          leftAction={{ label: 'Cancel', onPress: () => {} }}
          navTitle="Join with code"
          navTitleInset={100}
        >
          <View style={styles.sheetBody}>
            <AppText variant="subheadLoose" color="textSecondary">
              Paste the code someone sent you. A full invite link works too.
            </AppText>
          </View>
        </SheetPanel>
      </View>
      <View style={[styles.sheetStage, { backgroundColor: tokens.scrim }]}>
        <SheetPanel accessibilityLabel="Join a group" onClose={() => {}}>
          <View style={styles.sheetBody}>
            <AppText variant="body" color="textSecondary">
              You&apos;ve been invited to
            </AppText>
            <AppText variant="title1">Banff 2026</AppText>
          </View>
        </SheetPanel>
      </View>
      <Gutter>
        <Button label="Open a sheet" variant="secondary" onPress={() => setOpen(true)} />
      </Gutter>
      <Sheet
        visible={open}
        onDismiss={() => setOpen(false)}
        accessibilityLabel="New expense"
        leftAction={{ label: 'Cancel', onPress: () => setOpen(false) }}
        navTitle="New expense"
        top={116}
        bottom="keypad"
      >
        <View style={styles.sheetFill}>
          <AmountDisplay amount={3600} currency={CUR} locale={LOC} />
        </View>
        <Gutter>
          <TextField
            variant="title"
            accessibilityLabel="Title"
            defaultValue="Lake Louise shuttle"
            trailing={<CategoryChip emoji="🚆" label="Transit" state="suggested" />}
          />
          <Button label="Save" haptic="success" onPress={() => setOpen(false)} />
          <Keypad onKey={() => {}} />
        </Gutter>
      </Sheet>
    </>
  );
}

function BrandSection() {
  const { tokens } = useTheme();
  return (
    <>
      <Title>Mark and wordmark</Title>
      <Gutter gap={16}>
        <Row gap={16}>
          <View
            style={[
              styles.iconTile,
              { backgroundColor: tokens.background, borderColor: tokens.border },
            ]}
          >
            <Mark size={60} />
          </View>
          <Mark size={52} />
          <Mark size={44} />
          <Mark size={24} />
        </Row>
        <Wordmark variant="header" />
        <Wordmark variant="lockup" />
        <Row>
          <HeaderButton icon="gear" size={24} accessibilityLabel="Settings" onPress={() => {}} />
          <HeaderButton icon="share" accessibilityLabel="Share invite" onPress={() => {}} />
          <HeaderButton icon="gear" accessibilityLabel="Group settings" onPress={() => {}} />
        </Row>
      </Gutter>
      <Title>Empty state (rest frame)</Title>
      <View style={styles.center}>
        <EmptyStateMark />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  gap6: { gap: 6 },
  center: { alignItems: 'center' },
  schemeRow: { paddingHorizontal: layout.gutter, paddingTop: 4 },
  gutter: { paddingHorizontal: layout.gutter },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  note: { marginTop: 4 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeName: { width: 150 },
  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 36, height: 18, borderRadius: 4, borderWidth: 1 },
  fillBox: { padding: 16, borderRadius: 16 },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingLeft: 14,
    paddingRight: 10,
  },
  doneRowMany: { gap: 10, minHeight: 60 },
  appearanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 10,
  },
  cellRow: { flexDirection: 'row', gap: 12, padding: 12 },
  sheetStage: { paddingTop: 16, marginTop: 8 },
  sheetBody: { paddingHorizontal: 20, gap: 2 },
  sheetFill: { flex: 1, justifyContent: 'center', paddingVertical: 8 },
  iconTile: {
    width: 60,
    height: 60,
    borderRadius: 13.5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
