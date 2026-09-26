/**
 * New group (CreateGroup, CreateGroupDark): a sheet 110 pt from the top (the safe area + 48) over Groups, Cancel and
 * "New group" in its header, then, inset 16 with labels 6 above each field:
 * - Name: the large field (52, 20/25 semibold);
 * - Currency: a 52 pt row, the code 17/22 semibold and its name in `textSecondary`, a chevron; "From your phone's
 *   region. It can't be changed later.";
 * - People (optional): "Add a name" with the add button, removable chips 8 apart, "They'll pick their name when
 *   they join. You can add more later.";
 * - You in this group: a `fill` card (padding 16, gap 14) with the 72 pt avatar and pencil badge (opens the emoji
 *   picker) and "Your name" on `surface`; "Filled in from your defaults in Settings.";
 * - "Advanced: sync server", an outlined row showing the default host, collapsed;
 * - "Create group" pinned at the foot, 24 below the content at least.
 * On Create: the GroupService writes the creator's `member.added` and `member.claimed`, then `group.created`, then one
 * `member.added` per pre-added name (design.md "Invites" → Create), and the app opens the new group.
 */
import { memberColor, PROTOCOL } from '@even/core';
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

export interface CreateGroupPrefill {
  name?: string;
  currency?: string;
  people?: readonly string[];
  myName?: string;
  myEmoji?: string | null;
  /** Open the emoji picker at once (dev screenshots of the EmojiPicker board). */
  openEmojiPicker?: boolean;
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
  const { groups, deviceId } = useApp();
  const { prefs } = usePrefs();
  // A dev prefill stands in for the phone's region (the simulator's is US; the board's phone is in Canada).
  const deviceCurrency = useMemo(() => prefill?.currency ?? defaultCurrency(), [prefill?.currency]);

  const [name, setName] = useState(prefill?.name ?? '');
  const [currency, setCurrency] = useState(prefill?.currency ?? deviceCurrency);
  const [people, setPeople] = useState<string[]>([...(prefill?.people ?? [])]);
  const [person, setPerson] = useState('');
  const [personError, setPersonError] = useState<string | undefined>();
  const [myName, setMyName] = useState(prefill?.myName ?? '');
  const [myEmoji, setMyEmoji] = useState<string | null>(prefill?.myEmoji ?? null);
  const [fromDefaults, setFromDefaults] = useState(prefill?.myName !== undefined);
  const [advanced, setAdvanced] = useState(false);
  const [server, setServer] = useState<string>(PROTOCOL.defaultServer);
  const [serverError, setServerError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [picker, setPicker] = useState<'emoji' | 'currency' | null>(null);
  // iOS presents one sheet at a time: open the picker once this sheet is up.
  useEffect(() => {
    if (prefill?.openEmojiPicker !== true) return;
    const timer = setTimeout(() => setPicker('emoji'), 450);
    return () => clearTimeout(timer);
  }, [prefill?.openEmojiPicker]);
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
    if (prefs.name !== null) {
      setMyName(prefs.name);
      setFromDefaults(true);
    }
    setMyEmoji(prefs.emoji);
  }

  const addPerson = () => {
    const clean = person.trim();
    if (clean === '') return;
    if (isNameTaken(clean, [...people, myName])) {
      setPersonError(nameTakenMessage(clean));
      return;
    }
    setPeople((list) => [...list, clean]);
    setPerson('');
    setPersonError(undefined);
  };

  const canCreate = name.trim() !== '' && myName.trim() !== '' && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setFormError(undefined);
    setServerError(undefined);
    try {
      const pending = person.trim();
      const everyone =
        pending !== '' && !isNameTaken(pending, [...people, myName])
          ? [...people, pending]
          : people;
      const { localId } = await groups.createGroup({
        name: name.trim(),
        currency,
        myName: myName.trim(),
        ...(myEmoji === null ? {} : { myEmoji }),
        people: everyone,
        serverUrl: server.trim(),
      });
      onCreated(localId);
    } catch (error) {
      setBusy(false);
      if (isStateError(error, 'invalid_url')) {
        setAdvanced(true);
        setServerError("That isn't an https server address.");
      } else if (isStateError(error, 'clock')) {
        setFormError("Check your phone's date.");
      } else if (isStateError(error, 'name_taken')) {
        setFormError('Two people here have the same name.');
      } else {
        setFormError("The group couldn't be created.");
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
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
                    key={p}
                    name={p}
                    // No member id exists until Create; the name picks a stable palette colour meanwhile.
                    color={memberColor(p)}
                    onRemove={() => setPeople((list) => list.filter((other) => other !== p))}
                  />
                ))}
              </View>
            )}
            <Helper>They&apos;ll pick their name when they join. You can add more later.</Helper>
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
                  memberId={deviceId}
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
            {fromDefaults && <Helper>Filled in from your defaults in Settings.</Helper>}
          </View>

          <Pressable
            onPress={() => setAdvanced((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: advanced }}
            style={({ pressed }) => [
              styles.advanced,
              { borderColor: tokens.border },
              pressed && { backgroundColor: tokens.rowPressed },
            ]}
          >
            <View style={styles.advancedText}>
              <AppText variant="subhead" color="textSecondary">
                Advanced: sync server
              </AppText>
              <AppText variant="caption" color="textMuted" numberOfLines={1}>
                {hostOf(server.trim() === '' ? PROTOCOL.defaultServer : server.trim())}
              </AppText>
            </View>
            <View style={advanced && styles.flipped}>
              <Icon name="chevronDown" size={14} color={tokens.iconMuted} />
            </View>
          </Pressable>
          {advanced && (
            <TextField
              variant="row"
              value={server}
              onChangeText={(text) => {
                setServer(text);
                setServerError(undefined);
              }}
              accessibilityLabel="Sync server"
              placeholder={PROTOCOL.defaultServer}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              error={serverError}
              containerStyle={styles.server}
            />
          )}
          {formError !== undefined && <FieldError message={formError} style={styles.formError} />}
        </ScrollView>
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
          memberId={deviceId}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    marginTop: 16,
    marginHorizontal: 16,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: radii.group,
    borderWidth: strokes.hairline,
  },
  advancedText: { flex: 1, gap: 1 },
  flipped: { transform: [{ rotate: '180deg' }] },
  server: { marginTop: 8, marginHorizontal: 16 },
  formError: { marginTop: 16, marginHorizontal: 16 },
  create: { marginHorizontal: 16 },
});
