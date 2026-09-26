import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Sheet, SheetHeader, TextField } from '@/components';

export interface PromptSheetProps {
  visible: boolean;
  /** The centred title ("Rename", "Add member", "Move to another server"). */
  title: string;
  /** The header's trailing action ("Save", "Add", "Move"). */
  submitLabel: string;
  /** The field's text each time the sheet opens. */
  initialValue: string;
  placeholder: string;
  /** The line under the field, as the States board draws a name already taken. */
  error?: string;
  /** The action is running: the field and the action wait. */
  busy?: boolean;
  keyboard?: 'name' | 'url';
  /** Development screenshots: submit the initial value as soon as the sheet opens. */
  submitOnOpen?: boolean;
  /** The text changed (clears a stale error). */
  onEdit?: () => void;
  onSubmit: (value: string) => void;
  onDismiss: () => void;
}

/**
 * One text field in a sheet: Cancel · title · action in the header (as Add expense, Split and the emoji picker draw
 * theirs), then the 48 pt field of the States board with its error line. Content-sized, above the keyboard. Used
 * for Rename, Add member and Move to another server, which no board draws.
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
  error,
  busy = false,
  keyboard = 'name',
  submitOnOpen = false,
  onEdit,
  onSubmit,
  onDismiss,
}: Omit<PromptSheetProps, 'visible'>) {
  const [value, setValue] = useState(initialValue);
  const empty = value.trim() === '';
  const submit = () => {
    if (!empty && !busy) onSubmit(value);
  };

  useEffect(() => {
    if (submitOnOpen && initialValue.trim() !== '') onSubmit(initialValue);
    // Once, when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SheetHeader
        leftAction={{ label: 'Cancel', onPress: onDismiss }}
        rightAction={{ label: submitLabel, onPress: submit, disabled: empty || busy }}
        navTitle={title}
        navTitleInset={100}
      />
      <View style={styles.body}>
        <TextField
          variant="row"
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
          selectTextOnFocus={keyboard === 'name'}
          autoCorrect={false}
          autoCapitalize={keyboard === 'url' ? 'none' : 'words'}
          keyboardType={keyboard === 'url' ? 'url' : 'default'}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 8, paddingHorizontal: 16 },
});
