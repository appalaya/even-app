/**
 * Split's row controls, composed from kit pieces and tokens: the ×n shares stepper and the "+ extra" field. (The
 * include checkbox is the kit's `Checkbox`.)
 */
import { exponentOf, formatMinor } from '@even/core';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Icon } from '@/components';
import { applyKey, entryToMinor, minorToEntry } from '@/features/addExpense/amountEntry';
import { fontWeight, strokes, tabularNums, typography, useTheme } from '@/theme';

/**
 * The shares stepper (SplitEqual): 32 tall, fully round, a 1 pt `outline`; − and + at 12 pt in `textMuted` around
 * "×1" at 13/18. Any multiplier other than ×1 turns it soft accent with the figure bold in the accent.
 */
export function SharesStepper({
  weight,
  onChange,
  label,
}: {
  weight: number;
  onChange: (weight: number) => void;
  /** "Your shares", "Maya's shares". */
  label: string;
}) {
  const { tokens } = useTheme();
  const on = weight !== 1;
  const ink = on ? tokens.accent : tokens.textMuted;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `×${weight}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(weight + 1);
        if (e.nativeEvent.actionName === 'decrement') onChange(weight - 1);
      }}
      style={[
        styles.stepper,
        on
          ? { backgroundColor: tokens.accentSoft, borderColor: 'transparent' }
          : { borderColor: tokens.outline },
      ]}
    >
      <Pressable
        onPress={() => onChange(weight - 1)}
        hitSlop={{ top: 7, bottom: 7 }}
        accessibilityLabel="Fewer shares"
        style={styles.step}
      >
        <Icon name="minus" size={12} color={ink} strokeWidth={2.6} />
      </Pressable>
      <AppText
        variant="caption"
        weight={on ? 'bold' : 'regular'}
        color={on ? 'accent' : 'textMuted'}
        tabular
        style={styles.times}
      >
        ×{weight}
      </AppText>
      <Pressable
        onPress={() => onChange(weight + 1)}
        hitSlop={{ top: 7, bottom: 7 }}
        accessibilityLabel="More shares"
        style={styles.step}
      >
        <Icon name="plus" size={12} color={ink} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

/** Typed text (any locale's decimal comma) to minor units, through the keypad's own rules. */
function parseTyped(text: string, exponent: number): number {
  const typed = [...text.replace(',', '.')].filter((c) => c === '.' || (c >= '0' && c <= '9'));
  const entry = typed.reduce(
    (acc, c) => applyKey(acc, c as Parameters<typeof applyKey>[1], exponent),
    '',
  );
  return entryToMinor(entry, exponent);
}

/**
 * The "+ extra" field (SplitEqual): 72 × 32, fully round, a 1 pt dashed `outlineDashed` and "+ extra" in
 * `textMuted`; once it holds an amount, soft accent with "+$12.00" bold in the accent. Uses the system decimal pad
 * (the board draws no keypad in Equal).
 */
export function ExtraField({
  extra,
  currency,
  onChange,
  label,
}: {
  extra: number;
  currency: string;
  onChange: (minor: number) => void;
  /** "Extra for you", "Extra for Maya". */
  label: string;
}) {
  const { tokens } = useTheme();
  const exponent = exponentOf(currency);
  const [editing, setEditing] = useState<string | null>(null);
  const has = extra > 0 && editing === null;
  const shown = editing ?? (extra > 0 ? `+${formatMinor(extra, currency)}` : '');
  return (
    <View
      style={[
        styles.extra,
        has
          ? { backgroundColor: tokens.accentSoft, borderColor: 'transparent', borderStyle: 'solid' }
          : { borderColor: tokens.outlineDashed, borderStyle: 'dashed' },
      ]}
    >
      <TextInput
        value={shown}
        onChangeText={(text) => {
          setEditing(text);
          onChange(parseTyped(text, exponent));
        }}
        onFocus={() => setEditing(minorToEntry(extra, exponent))}
        onBlur={() => setEditing(null)}
        placeholder="+ extra"
        placeholderTextColor={tokens.textMuted}
        keyboardType="decimal-pad"
        selectionColor={tokens.accent}
        cursorColor={tokens.accent}
        accessibilityLabel={label}
        maxFontSizeMultiplier={1.4}
        style={[
          typography.caption,
          styles.extraInput,
          { color: has ? tokens.accent : tokens.text },
          has && styles.extraOn,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: 16,
    borderWidth: strokes.hairline,
  },
  step: { width: 26, height: 30, alignItems: 'center', justifyContent: 'center' },
  times: { minWidth: 28, textAlign: 'center' },
  extra: {
    width: 72,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 16,
    borderWidth: strokes.hairline,
    justifyContent: 'center',
  },
  extraInput: { padding: 0, textAlign: 'center', ...tabularNums },
  extraOn: { fontWeight: fontWeight.bold },
});
