/**
 * New group (CreateGroup, CreateGroupDark): a sheet 110 pt from the top (the safe area + 48) over Groups, Cancel and
 * "New group" in its header, then, inset 16 with labels 6 above each field:
 * - Name: the large field (52, 20/25 semibold);
 * - Currency: a 52 pt row, the code 17/22 semibold and its name in `textSecondary`, a chevron; "From your phone's
 *   region. It can't be changed later.";
 * - People (optional): "Add a name" with the add button, removable chips 8 apart, "They'll pick their name when
 *   they join.";
 * - You in this group: a `fill` card (padding 16, gap 14) with the 72 pt avatar and pencil badge (opens the emoji
 *   picker) and "Your name" on `surface`, filled in from App settings' defaults;
 * - "Advanced: sync server", an outlined row showing the default host, collapsed; open (Groups, extra states:
 *   "Create, Advanced open") the outline holds the row, the URL field (48, radius 12, 16/21) and "Only change this
 *   if you run your own Even server.";
 * - "Create group" pinned at the foot, 24 below the content at least.
 * On Create: the GroupService writes the creator's `member.added` and `member.claimed`, then `group.created`, then one
 * `member.added` per pre-added name (design.md "Invites" → Create), and the app opens the new group. A server other
 * than the default is checked first (`/v1/info`). The error copy is the panel's: under the server field as you leave
 * it or after Create, and "Couldn't create the group. Try again." just above Create group.
 */
import { memberColor, newId, PROTOCOL } from '@even/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppText,
  Avatar,
  Button,
  FieldLabel,
  Icon,
  MemberChip,
  Sheet,
  TextField,
} from '@/components';
import { EmojiPickerSheet } from '@/features/emoji/EmojiPickerSheet';
import { hostOf } from '@/features/join/invite';
import { isStateError, useApp, usePrefs } from '@/state';
import { radii, strokes, useTheme } from '@/theme';

import { currencyName, defaultCurrency } from './currencies';
import { CurrencyPickerSheet } from './CurrencyPickerSheet';
import { FieldError } from './FieldError';
import { isNameTaken, nameTakenMessage } from './names';
import { serverAddressProblem, serverProblemMessage } from './serverCopy';

/** A pre-added name and the member id it will have (so its avatar previews the member's real colour). */
export interface PersonDraft {
  name: string;
  id: string;
}

export interface CreateGroupPrefill {
  name?: string;
  currency?: string;
  people?: readonly PersonDraft[];
  myName?: string;
  myEmoji?: string | null;
  /** Open the emoji picker at once (dev screenshots of the EmojiPicker board). */
  openEmojiPicker?: boolean;
  /** Open the currency picker at once (dev screenshots of the currency picker). */
  openCurrencyPicker?: boolean;
  /** Open "Advanced: sync server" (dev screenshots). */
  advancedOpen?: boolean;
  /** Scroll to the end once open (dev screenshots of the board's full scroll). */
  scrollToEnd?: boolean;
}

export interface CreateGroupSheetProps {
  visible: boolean;
  onCancel: () => void;
  onCreated: (localId: string) => void;
  prefill?: CreateGroupPrefill;
}

export function CreateGroupSheet({ visible, onCancel, onCreated, prefill }: CreateGroupSheetProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { groups } = useApp();
  const { prefs } = usePrefs();
  // A dev prefill stands in for the phone's region (the simulator's is US; the board's phone is in Canada).
  const deviceCurrency = useMemo(() => prefill?.currency ?? defaultCurrency(), [prefill?.currency]);

  const [name, setName] = useState(prefill?.name ?? '');
  const [currency, setCurrency] = useState(prefill?.currency ?? deviceCurrency);
  const [people, setPeople] = useState<PersonDraft[]>([...(prefill?.people ?? [])]);
  // Your member id is chosen now, so the avatar here is the colour you will have.
  const [myId] = useState(() => newId());
  const [scrolled, setScrolled] = useState(false);
  const [person, setPerson] = useState('');
  const [personError, setPersonError] = useState<string | undefined>();
  const [myName, setMyName] = useState(prefill?.myName ?? '');
  const [myEmoji, setMyEmoji] = useState<string | null>(prefill?.myEmoji ?? null);
  const [advanced, setAdvanced] = useState(prefill?.advancedOpen === true);
  const [server, setServer] = useState<string>(PROTOCOL.defaultServer);
  const [serverError, setServerError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [picker, setPicker] = useState<'emoji' | 'currency' | null>(null);
  // iOS presents one sheet at a time: open the picker once this sheet is up.
  useEffect(() => {
    const open =
      prefill?.openEmojiPicker === true
        ? 'emoji'
        : prefill?.openCurrencyPicker === true
          ? 'currency'
          : null;
    if (open === null) return;
    const timer = setTimeout(() => setPicker(open), 450);
    return () => clearTimeout(timer);
  }, [prefill?.openEmojiPicker, prefill?.openCurrencyPicker]);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (prefill?.scrollToEnd !== true) return;
    const timer = setTimeout(() => scroller.current?.scrollToEnd({ animated: false }), 600);
    return () => clearTimeout(timer);
  }, [prefill?.scrollToEnd]);

  // "You in this group" is filled in from App settings' defaults once they load (adjusted during render).
  const [seeded, setSeeded] = useState(prefill?.myName !== undefined);
  if (!seeded && prefs !== null) {
    setSeeded(true);
    if (prefs.name !== null) setMyName(prefs.name);
    setMyEmoji(prefs.emoji);
  }

  const addPerson = () => {
    const clean = person.trim();
    if (clean === '') return;
    if (isNameTaken(clean, [...people.map((p) => p.name), myName])) {
      setPersonError(nameTakenMessage(clean));
      return;
    }
    setPeople((list) => [...list, { name: clean, id: newId() }]);
    setPerson('');
    setPersonError(undefined);
  };

  const canCreate = name.trim() !== '' && myName.trim() !== '' && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setFormError(undefined);
    setServerError(undefined);
    const serverUrl = server.trim() === '' ? PROTOCOL.defaultServer : server.trim();
    if (serverUrl !== PROTOCOL.defaultServer) {
      const check = await groups.checkServer(serverUrl);
      if (!check.ok) {
        setBusy(false);
        setAdvanced(true);
        setServerError(serverProblemMessage(check.problem));
        return;
      }
    }
    try {
      const pending = person.trim();
      const everyone =
        pending !== '' && !isNameTaken(pending, [...people.map((p) => p.name), myName])
          ? [...people, { name: pending, id: newId() }]
          : people;
      const { localId } = await groups.createGroup({
        name: name.trim(),
        currency,
        myName: myName.trim(),
        myId,
        ...(myEmoji === null ? {} : { myEmoji }),
        people: everyone,
        serverUrl,
      });
      onCreated(localId);
    } catch (error) {
      setBusy(false);
      if (isStateError(error, 'invalid_url')) {
        setAdvanced(true);
        setServerError(serverProblemMessage('invalid_url'));
      } else if (isStateError(error, 'clock')) {
        setFormError("Check your phone's date.");
      } else if (isStateError(error, 'name_taken')) {
        setFormError('Two people here have the same name.');
      } else {
        setFormError("Couldn't create the group. Try again.");
        console.warn('create group failed', error instanceof Error ? error.message : error);
      }
    }
  };

  return (
    <>
      <Sheet
        visible={visible}
        onDismiss={onCancel}
        top={insets.top + 48}
        leftAction={{ label: 'Cancel', onPress: onCancel }}
        navTitle="New group"
        accessibilityLabel="New group"
      >
        <ScrollView
          ref={scroller}
          style={[
            styles.flex,
            scrolled && { borderTopWidth: strokes.hairline, borderTopColor: tokens.separator },
          ]}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={32}
          // Scrolled, a hairline separates the content from the header (Groups, extra states: Advanced open).
          onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 0)}
        >
          <TextField
            variant="large"
            label="Name"
            value={name}
            onChangeText={setName}
            returnKeyType="next"
            autoCapitalize="words"
            containerStyle={styles.first}
          />

          <View style={styles.group}>
            <FieldLabel>Currency</FieldLabel>
            <Pressable
              onPress={() => setPicker('currency')}
              accessibilityRole="button"
              accessibilityLabel={`Currency: ${currencyName(currency)}, ${currency}. Change.`}
              style={({ pressed }) => [
                styles.currency,
                { backgroundColor: pressed ? tokens.fillPressed : tokens.fill },
              ]}
            >
              <AppText weight="semibold">{currency}</AppText>
              <AppText color="textSecondary" numberOfLines={1} style={styles.flex}>
                {currencyName(currency)}
              </AppText>
              <Icon name="chevronRight" size={16} color={tokens.iconMuted} />
            </Pressable>
            <Helper>
              {currency === deviceCurrency
                ? "From your phone's region. It can't be changed later."
                : "It can't be changed later."}
            </Helper>
          </View>

          <View style={styles.group}>
            <FieldLabel>People (optional)</FieldLabel>
            <TextField
              variant="row"
              value={person}
              onChangeText={(text) => {
                setPerson(text);
                setPersonError(undefined);
              }}
              placeholder="Add a name"
              accessibilityLabel="Add a name"
              autoCapitalize="words"
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={addPerson}
              onAdd={addPerson}
              error={personError}
            />
            {people.length > 0 && (
              <View style={styles.chips}>
                {people.map((p) => (
                  <MemberChip
                    key={p.id}
                    name={p.name}
                    color={memberColor(p.id)}
                    onRemove={() => setPeople((list) => list.filter((other) => other.id !== p.id))}
                  />
                ))}
              </View>
            )}
            <Helper>They&apos;ll pick their name when they join.</Helper>
          </View>

          <View style={styles.group}>
            <FieldLabel>You in this group</FieldLabel>
            <View style={[styles.you, { backgroundColor: tokens.fill }]}>
              <Pressable
                onPress={() => setPicker('emoji')}
                accessibilityRole="button"
                accessibilityLabel={
                  myEmoji === null
                    ? `Your avatar, initials. Change avatar.`
                    : `Your avatar, ${myEmoji}. Change avatar.`
                }
                style={styles.avatar}
              >
                <Avatar
                  size={72}
                  name={myName === '' ? undefined : myName}
                  emoji={myEmoji ?? undefined}
                  memberId={myId}
                  on="fill"
                  badge="pencil"
                  badgeRing={tokens.fill}
                />
              </Pressable>
              <View style={styles.yourName}>
                <AppText variant="caption" weight="medium" color="textSecondary">
                  Your name
                </AppText>
                <TextField
                  variant="inline"
                  on="fill"
                  value={myName}
                  onChangeText={setMyName}
                  accessibilityLabel="Your name"
                  autoCapitalize="words"
                  textContentType="givenName"
                />
              </View>
            </View>
          </View>

          <View style={[styles.advanced, { borderColor: tokens.border }]}>
            <Pressable
              onPress={() => setAdvanced((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: advanced }}
              style={({ pressed }) => [
                styles.advancedRow,
                advanced ? styles.advancedRowOpen : styles.advancedRowClosed,
                pressed && { backgroundColor: tokens.rowPressed },
              ]}
            >
              <View style={styles.advancedText}>
                <AppText variant="subhead" color="textSecondary">
                  Advanced: sync server
                </AppText>
                {!advanced && (
                  <AppText variant="caption" color="textMuted" numberOfLines={1}>
                    {hostOf(server.trim() === '' ? PROTOCOL.defaultServer : server.trim())}
                  </AppText>
                )}
              </View>
              <Icon
                name={advanced ? 'chevronUp' : 'chevronDown'}
                size={14}
                color={tokens.iconMuted}
              />
            </Pressable>
            {advanced && (
              <View style={styles.serverBody}>
                <TextField
                  variant="url"
                  value={server}
                  onChangeText={(text) => {
                    setServer(text);
                    setServerError(undefined);
                  }}
                  onBlur={() => {
                    const problem = serverAddressProblem(server);
                    if (problem !== null) setServerError(serverProblemMessage(problem));
                  }}
                  accessibilityLabel="Sync server"
                  placeholder={PROTOCOL.defaultServer}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  error={serverError}
                />
                <AppText variant="caption" color="textMuted" style={styles.helper}>
                  Only change this if you run your own Even server.
                </AppText>
              </View>
            )}
          </View>
        </ScrollView>
        {formError !== undefined && <FieldError message={formError} style={styles.formError} />}
        <Button
          label="Create group"
          onPress={() => void create()}
          disabled={!canCreate}
          haptic="success"
          style={styles.create}
        />
        {/* Inside the sheet, so iOS presents them from its modal rather than from the one already presenting. */}
        <EmojiPickerSheet
          visible={picker === 'emoji'}
          onDismiss={() => setPicker(null)}
          value={myEmoji}
          onPick={(emoji) => {
            setMyEmoji(emoji);
            setPicker(null);
          }}
          onUseInitials={() => {
            setMyEmoji(null);
            setPicker(null);
          }}
          name={myName === '' ? '?' : myName}
          memberId={myId}
        />
        <CurrencyPickerSheet
          visible={picker === 'currency'}
          onDismiss={() => setPicker(null)}
          value={currency}
          deviceCurrency={deviceCurrency}
          onPick={(code) => {
            setCurrency(code);
            setPicker(null);
          }}
        />
      </Sheet>
    </>
  );
}

function Helper({ children }: { children: string }) {
  return (
    <AppText variant="caption" color="textMuted" style={styles.helper}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 24 },
  first: { marginTop: 8, marginHorizontal: 16 },
  group: { gap: 6, marginTop: 16, marginHorizontal: 16 },
  helper: { paddingHorizontal: 4 },
  currency: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: radii.group,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  you: { gap: 14, padding: 16, borderRadius: radii.group },
  avatar: { alignSelf: 'center' },
  yourName: { gap: 6 },
  advanced: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: radii.group,
    borderWidth: strokes.hairline,
    overflow: 'hidden',
  },
  advancedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 14,
  },
  /** Collapsed: min 56, padding 8 · 14 · 8 · 16, the host under the label (CreateGroup). */
  advancedRowClosed: { minHeight: 54, paddingVertical: 8 },
  /** Open: min 52 inside the outline, no host line (Groups, extra states). */
  advancedRowOpen: { minHeight: 52 },
  advancedText: { flex: 1, gap: 1 },
  serverBody: { gap: 8, paddingHorizontal: 12, paddingBottom: 14 },
  /** "Couldn't create the group. Try again." just above Create group, as Save's error on Add expense. */
  formError: { marginBottom: 10, marginHorizontal: 16 },
  create: { marginHorizontal: 16 },
});
