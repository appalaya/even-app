import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';

import { fontWeight, radii, strokes, tabularNums, typography, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { FieldLabel } from './SectionHeader';

/**
 * Field shapes as drawn (all on `fill` unless noted):
 * - `large`  52 · radius 16 · 20/25 semibold (Create group: Name).
 * - `title`  56 · radius 16 · 17/22, a trailing accessory (Add expense: the title with its category chip).
 * - `row`    48 · radius 16 · 17/22, a trailing 36 pt add button (Create group: "Add a name"); without the button,
 *            padding 16 at both ends (States: "Add a name", the Name field in error).
 * - `inline` 44 · radius 12 · 17/22 ("Your name", "Name"); on `surface` when the card around it is `fill`.
 * - `url`    48 · radius 12 · 16/21, padding 14 (Create group: the sync server, Advanced open; Move server's "New
 *            server" draws radius 14, via `radius`).
 * - `pill`   44 · radius 22 · 15/20 (Settle: "Note (optional)").
 * - `cell`   40 · radius 10 · 16/21 medium, right-aligned tabular, on `surface`; a 2 pt accent ring while focused
 *            (Split amounts and percentages).
 * - `code`   208 · radius 18 · 15/22 mono, multiline, Scan and Paste pills in the corner, 8 apart (Join with code).
 *
 * While focused, `large`, `title`, `row` and `cell` draw a 2 pt accent ring (Add expense typing the title; Rename
 * group; Add member; a Split cell).
 *
 * Placeholder text is `textMuted` (Palette, States). An `error` draws a 1.5 pt inset ring in `text` on any shape
 * and the message under it: on `code` a 20 pt warning glyph, 10 pt gap, 16/22 semibold, 14 below the field
 * (JoinCodeError); on every other shape a 16 pt glyph (stroke 2.2), 8 pt gap, 14/19 semibold, 8 below, inset 4
 * (States: "Someone here is already called Maya.").
 */
export type TextFieldVariant =
  'large' | 'title' | 'row' | 'inline' | 'url' | 'pill' | 'cell' | 'code';

interface Spec {
  minHeight: number;
  radius: number;
  paddingLeft: number;
  paddingRight: number;
  text: TextInputProps['style'];
}

const SPECS: Record<TextFieldVariant, Spec> = {
  large: {
    minHeight: 52,
    radius: radii.group,
    paddingLeft: 16,
    paddingRight: 16,
    text: { ...typography.headline },
  },
  title: {
    minHeight: 56,
    radius: radii.group,
    paddingLeft: 16,
    paddingRight: 8,
    text: typography.body,
  },
  row: {
    minHeight: 48,
    radius: radii.group,
    paddingLeft: 16,
    paddingRight: 6,
    text: typography.body,
  },
  inline: {
    minHeight: 44,
    radius: radii.control,
    paddingLeft: 14,
    paddingRight: 14,
    text: typography.body,
  },
  url: {
    minHeight: 48,
    radius: radii.control,
    paddingLeft: 14,
    paddingRight: 14,
    text: typography.callout,
  },
  pill: { minHeight: 44, radius: 22, paddingLeft: 16, paddingRight: 16, text: typography.subhead },
  cell: {
    minHeight: 40,
    radius: radii.cell,
    paddingLeft: 12,
    paddingRight: 12,
    text: {
      ...typography.callout,
      fontWeight: fontWeight.medium,
      textAlign: 'right',
      ...tabularNums,
    },
  },
  code: {
    minHeight: 208,
    radius: radii.card,
    paddingLeft: 16,
    paddingRight: 16,
    text: typography.monoLoose,
  },
};

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  variant?: TextFieldVariant;
  /** A label above the field (13/18 medium `textSecondary`, 6 above the field). */
  label?: string;
  /** A caption under the field (13/18 `textMuted`, 6 below). */
  helper?: string;
  /** Something at the trailing edge inside the field (the category chip). */
  trailing?: ReactNode;
  /** `row`: the add button's action. */
  onAdd?: () => void;
  /** `code`: the Paste button's action. */
  onPaste?: () => void;
  /** `code`: the Scan button's action; the pill sits before Paste (JoinCode). */
  onScan?: () => void;
  /**
   * The error line under the field; also rings the field. `code`: "That code isn't complete. Copy it again.";
   * a name: "Someone here is already called Maya."
   */
  error?: string;
  /** `inline` inside a `fill` card sits on `surface` (Create group's You card). */
  on?: 'surface' | 'fill';
  /** `cell`: the one the keypad is editing; draws the 2 pt accent ring (as focus does). */
  active?: boolean;
  /** Fixed width (`cell`: 100 for amounts, 76 for percentages). */
  width?: number;
  /** Overrides the variant's corner radius (Move server's field: 14). */
  radius?: number;
  containerStyle?: ViewProps['style'];
}

/** A sheet's slide-in (`Sheet`, 300 ms), after which an Android field with `autoFocus` asks for the keyboard again. */
const ANDROID_REFOCUS_MS = 320;

/** A text field in one of the canvas shapes. Placeholder text is `textMuted`, the caret and selection the accent. */
export function TextField({
  variant = 'inline',
  label,
  helper,
  trailing,
  onAdd,
  onPaste,
  onScan,
  error,
  on = 'surface',
  active = false,
  width,
  radius,
  containerStyle,
  onFocus,
  onBlur,
  ...input
}: TextFieldProps) {
  const { tokens } = useTheme();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const autoFocus = input.autoFocus === true;
  // Android: a field that mounts with `autoFocus` in a sheet (a `Modal`, a window of its own) takes focus before that
  // window does, so the caret showed and the keyboard stayed down (Rename group, Add member). There it is focused once
  // the sheet has slid in (300 ms) instead, which raises the keyboard.
  useEffect(() => {
    if (Platform.OS !== 'android' || !autoFocus) return;
    const timer = setTimeout(() => inputRef.current?.focus(), ANDROID_REFOCUS_MS);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  const spec = SPECS[variant];
  const background =
    variant === 'cell' || (variant === 'inline' && on === 'fill') ? tokens.surface : tokens.fill;
  const focusRing =
    variant === 'large' ||
    variant === 'title' ||
    variant === 'row' ||
    variant === 'url' ||
    variant === 'cell';
  const ring =
    error !== undefined
      ? `inset 0 0 0 ${strokes.selected}px ${tokens.text}`
      : (focusRing && focused) || (variant === 'cell' && active)
        ? `0 0 0 ${strokes.ring}px ${tokens.accent}`
        : undefined;
  const paddingRight =
    variant === 'row' && onAdd === undefined ? spec.paddingLeft : spec.paddingRight;

  const field = (
    <View
      style={[
        styles.field,
        {
          minHeight: spec.minHeight,
          borderRadius: radius ?? spec.radius,
          paddingLeft: variant === 'code' ? 0 : spec.paddingLeft,
          paddingRight: variant === 'code' ? 0 : paddingRight,
          backgroundColor: background,
          width,
          boxShadow: ring,
        },
        variant === 'code' && styles.codeField,
      ]}
    >
      <TextInput
        {...input}
        ref={inputRef}
        autoFocus={Platform.OS === 'android' ? false : input.autoFocus}
        multiline={variant === 'code' ? true : input.multiline}
        accessibilityLabel={input.accessibilityLabel ?? label}
        accessibilityHint={error ?? input.accessibilityHint}
        placeholderTextColor={tokens.textMuted}
        selectionColor={tokens.accent}
        cursorColor={tokens.accent}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          spec.text,
          { color: tokens.text },
          styles.input,
          variant === 'code' && styles.codeInput,
        ]}
      />
      {trailing}
      {variant === 'row' && onAdd !== undefined && (
        <Pressable
          onPress={onAdd}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Add person"
          style={[styles.add, { backgroundColor: tokens.accent }]}
        >
          <Icon name="plus" size={16} color={tokens.onAccent} strokeWidth={2.6} />
        </Pressable>
      )}
      {variant === 'code' && (onPaste !== undefined || onScan !== undefined) && (
        <View style={styles.codeActions}>
          {onScan !== undefined && <CodePill label="Scan" icon="scan" onPress={onScan} />}
          {onPaste !== undefined && <CodePill label="Paste" icon="paste" onPress={onPaste} />}
        </View>
      )}
    </View>
  );

  if (label === undefined && helper === undefined && error === undefined) {
    return containerStyle === undefined ? field : <View style={containerStyle}>{field}</View>;
  }
  return (
    <View style={[styles.group, containerStyle]}>
      {label !== undefined && <FieldLabel>{label}</FieldLabel>}
      {field}
      {helper !== undefined && (
        <AppText variant="caption" color="textMuted" style={styles.helper}>
          {helper}
        </AppText>
      )}
      {error !== undefined &&
        (variant === 'code' ? (
          <View style={styles.codeError} accessibilityRole="alert">
            <View style={styles.errorIcon}>
              <Icon name="warning" size={20} color={tokens.text} />
            </View>
            <AppText weight="semibold" style={styles.codeErrorText}>
              {error}
            </AppText>
          </View>
        ) : (
          <View style={styles.fieldError} accessibilityRole="alert">
            <View style={styles.errorIcon}>
              <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
            </View>
            <AppText variant="footnote" weight="semibold" style={styles.flex}>
              {error}
            </AppText>
          </View>
        ))}
    </View>
  );
}

/** A 40 pt soft-accent pill in the code field's corner: a 16 pt glyph and a 15/20 semibold label, 6 apart. */
function CodePill({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: 'scan' | 'paste';
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={2}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: tokens.accentSoft },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={16} color={tokens.accent} />
      <AppText variant="subhead" weight="semibold" color="accent">
        {label}
      </AppText>
    </Pressable>
  );
}

/** Search (Emoji picker): 44 tall, radius 12, `fill`, an 18 pt magnifier and 16/21 text. */
export function SearchField({
  containerStyle,
  ...input
}: Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  containerStyle?: ViewProps['style'];
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: tokens.fill }, containerStyle]}>
      <Icon name="search" size={18} color={tokens.textMuted} />
      <TextInput
        {...input}
        accessibilityLabel={input.accessibilityLabel ?? input.placeholder}
        returnKeyType="search"
        placeholderTextColor={tokens.textMuted}
        selectionColor={tokens.accent}
        cursorColor={tokens.accent}
        style={[typography.callout, { color: tokens.text }, styles.input]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minWidth: 0, paddingVertical: 0 },
  codeField: { alignItems: 'stretch' },
  codeInput: {
    paddingTop: 16,
    paddingBottom: 60,
    paddingHorizontal: 16,
    textAlignVertical: 'top',
  },
  helper: { paddingHorizontal: 4 },
  add: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeActions: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: 20,
  },
  /** JoinCodeError: 14 below the field (6 group gap + 8), inset 4 from the field's edge. */
  codeError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 8,
    marginHorizontal: 4,
  },
  codeErrorText: { flex: 1, fontSize: 16, lineHeight: 22 },
  /** States: 8 below the field (6 group gap + 2), padding 0 4. */
  fieldError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 2,
    paddingHorizontal: 4,
  },
  errorIcon: { paddingTop: 1 },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radii.control,
  },
});
