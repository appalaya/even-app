/**
 * The paid-by, from/to and date pickers. No board draws them, so they use the system action sheet (no custom
 * design) until one does; see the stack C report.
 */
import { ActionSheetIOS } from 'react-native';

export interface PickOption<T> {
  label: string;
  value: T;
}

export function pick<T>({
  title,
  options,
  scheme,
  tint,
  onPick,
}: {
  title: string;
  options: readonly PickOption<T>[];
  scheme: 'light' | 'dark';
  tint: string;
  onPick: (value: T) => void;
}): void {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      options: [...options.map((o) => o.label), 'Cancel'],
      cancelButtonIndex: options.length,
      userInterfaceStyle: scheme,
      tintColor: tint,
    },
    (index) => {
      const chosen = options[index];
      if (chosen !== undefined) onPick(chosen.value);
    },
  );
}
