import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Sheet, SheetHeader, TextField } from '@/components';

export interface PromptSheetProps {
  visible: boolean;
  /** The centred title ("Rename group", "Rename"). */
  title: string;
  /** The header's trailing action ("Save"). */
  submitLabel: string;
  /** The field's text each time the sheet opens. */
  initialValue: string;
  placeholder?: string;
  /** `large` (52, 20/25 semibold: a group name) or `row` (48, 17/22: a member's name). */
  variant?: 'large' | 'row';
  /** The caption under the field ("Everyone in the group sees the new name."). */
  hint?: string;
  /** Longest input, in characters. */
  maxLength?: number;
  /** The line under the field, as the States board draws a name already taken. */
  error?: string;
  /** The action is running: the field and the action wait. */
  busy?: boolean;
  /** Development screenshots: text already typed over `initialValue` (Save compares against `initialValue`). */
  draft?: string;
  /** The text changed (clears a stale error). */
  onEdit?: () => void;
  onSubmit: (value: string) => void;
  onDismiss: () => void;
}

/**
 * One text field in a sheet (Group settings, extra states: "Rename group"): Cancel · title · Save in the header,
 * then the field 12 below (a 2 pt accent ring while typing) and its caption 8 below; content-sized, 12 above the
 * keyboard. Save turns on once the text changes and is not empty. A member's rename uses the same sheet with the
 * 48 pt field.
 */
export function PromptSheet({ visible, onDismiss, title, ...body }: PromptSheetProps) {
  return (
    <Sheet visible={visible} onDismiss={onDismiss} accessibilityLabel={title}>
      {/* The sheet's content mounts on each open, so the field starts from `initialValue` every time. */}
      <PromptBody title={title} onDismiss={onDismiss} {...body} />
    </Sheet>
  );
}

function PromptBody({
  title,
  submitLabel,
  initialValue,
  placeholder,
  variant = 'large',
  hint,
  maxLength,
  error,
  busy = false,
  draft,
  onEdit,
  onSubmit,
  onDismiss,
}: Omit<PromptSheetProps, 'visible'>) {
  const [value, setValue] = useState(draft ?? initialValue);
  const clean = value.trim();
  const off = clean === '' || clean === initialValue.trim() || busy;
  const submit = () => {
    if (!off) onSubmit(value);
  };

  return (
    <>
      <SheetHeader
        leftAction={{ label: 'Cancel', onPress: onDismiss }}
        rightAction={{ label: submitLabel, onPress: submit, disabled: off }}
        navTitle={title}
      />
      <View style={styles.body}>
        <TextField
          variant={variant}
          value={value}
          onChangeText={(text) => {
            setValue(text);
            onEdit?.();
          }}
          placeholder={placeholder}
          accessibilityLabel={title}
          error={error}
          editable={!busy}
          autoFocus
          maxLength={maxLength}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        {hint !== undefined && (
          <AppText variant="caption" color="textMuted" style={styles.hint}>
            {hint}
          </AppText>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 12, paddingHorizontal: 16 },
  hint: { marginTop: 8, marginHorizontal: 4 },
});
