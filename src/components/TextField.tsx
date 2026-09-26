import { useState, type ReactNode } from 'react';
import {
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
 * - `row`    48 · radius 16 · 17/22, a trailing 36 pt add button (Create group: "Add a name").
 * - `inline` 44 · radius 12 · 17/22 ("Your name", "Name"); on `surface` when the card around it is `fill`.
 * - `pill`   44 · radius 22 · 15/20 (Settle: "Note (optional)").
 * - `cell`   40 · radius 10 · 16/21 medium, right-aligned tabular, on `surface`; a 2 pt accent ring while focused
 *            (Split amounts and percentages).
 * - `code`   208 · radius 18 · 15/22 mono, multiline, a Paste button in the corner; an error draws a 1.5 pt
 *            inset ring in `text` and the message under it (Join with code).
 */
export type TextFieldVariant = 'large' | 'title' | 'row' | 'inline' | 'pill' | 'cell' | 'code';

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
  /** `code`: the message under an unreadable code ("That code isn't complete. Copy it again."). */
  error?: string;
  /** `inline` inside a `fill` card sits on `surface` (Create group's You card). */
  on?: 'surface' | 'fill';
  /** `cell`: the one the keypad is editing; draws the 2 pt accent ring (as focus does). */
  active?: boolean;
  /** Fixed width (`cell`: 100 for amounts, 76 for percentages). */
  width?: number;
  containerStyle?: ViewProps['style'];
}

/** A text field in one of the canvas shapes. Placeholder text is `glyph`, the caret and selection the accent. */
export function TextField({
  variant = 'inline',
  label,
  helper,
  trailing,
  onAdd,
  onPaste,
  error,
  on = 'surface',
  active = false,
  width,
  containerStyle,
  onFocus,
  onBlur,
  ...input
}: TextFieldProps) {
  const { tokens } = useTheme();
  const [focused, setFocused] = useState(false);
  const spec = SPECS[variant];
  const background =
    variant === 'cell' || (variant === 'inline' && on === 'fill') ? tokens.surface : tokens.fill;
  const ring =
    variant === 'cell' && (focused || active)
      ? `0 0 0 ${strokes.ring}px ${tokens.accent}`
      : variant === 'code' && error !== undefined
        ? `inset 0 0 0 ${strokes.selected}px ${tokens.text}`
        : undefined;

  const field = (
    <View
      style={[
        styles.field,
        {
          minHeight: spec.minHeight,
          borderRadius: spec.radius,
          paddingLeft: variant === 'code' ? 0 : spec.paddingLeft,
          paddingRight: variant === 'code' ? 0 : spec.paddingRight,
          backgroundColor: background,
          width,
          boxShadow: ring,
        },
        variant === 'code' && styles.codeField,
      ]}
    >
      <TextInput
        {...input}
        multiline={variant === 'code' ? true : input.multiline}
        accessibilityLabel={input.accessibilityLabel ?? label}
        accessibilityHint={error ?? input.accessibilityHint}
        placeholderTextColor={tokens.glyph}
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
      {variant === 'code' && onPaste !== undefined && (
        <Pressable
          onPress={onPaste}
          hitSlop={2}
          accessibilityRole="button"
          accessibilityLabel="Paste"
          style={[styles.paste, { backgroundColor: tokens.accentSoft }]}
        >
          <Icon name="paste" size={16} color={tokens.accent} />
          <AppText variant="subhead" weight="semibold" color="accent">
            Paste
          </AppText>
        </Pressable>
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
      {error !== undefined && (
        <View style={styles.error} accessibilityRole="alert">
          <View style={styles.errorIcon}>
            <Icon name="warning" size={20} color={tokens.text} />
          </View>
          <AppText weight="semibold" style={styles.errorText}>
            {error}
          </AppText>
        </View>
      )}
    </View>
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
        placeholderTextColor={tokens.glyph}
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
  paste: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: 20,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 8,
    marginHorizontal: 4,
  },
  errorIcon: { paddingTop: 1 },
  errorText: { flex: 1, fontSize: 16, lineHeight: 22 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radii.control,
  },
});
