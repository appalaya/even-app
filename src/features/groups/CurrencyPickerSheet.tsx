/**
 * Picks the group's currency: the device's first, then the common ones, then every other ISO code (core's
 * `CURRENCY_EXPONENTS`). No board draws this sheet; it is composed from the drawn picker pattern (EmojiPicker: Cancel
 * and a centred title, a search field 8 below) and settings rows (code semibold, name `textSecondary`, as the
 * Create group currency row draws them), and listed in the stack report.
 */
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Icon, ListRow, SearchField, Separator, Sheet } from '@/components';
import { radii, useTheme } from '@/theme';

import { currencyName, matchesCurrency, orderedCurrencies } from './currencies';

export function CurrencyPickerSheet({
  visible,
  onDismiss,
  value,
  deviceCurrency,
  onPick,
}: {
  visible: boolean;
  onDismiss: () => void;
  value: string;
  deviceCurrency: string;
  onPick: (code: string) => void;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const all = useMemo(
    () => orderedCurrencies(deviceCurrency).map((code) => ({ code, name: currencyName(code) })),
    [deviceCurrency],
  );
  const shown = all.filter((c) => matchesCurrency(c.code, c.name, query));

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      top={insets.top + 48}
      leftAction={{ label: 'Cancel', onPress: onDismiss }}
      navTitle="Currency"
      accessibilityLabel="Choose a currency"
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search currencies"
        autoCorrect={false}
        autoCapitalize="none"
        containerStyle={styles.search}
      />
      <FlatList
        style={styles.flex}
        contentContainerStyle={[styles.list, { backgroundColor: tokens.surfaceInset }]}
        keyboardShouldPersistTaps="handled"
        data={shown}
        keyExtractor={(c) => c.code}
        ItemSeparatorComponent={() => <Separator inset={16} tone="inset" />}
        renderItem={({ item }) => (
          <ListRow
            title={
              <View style={styles.title}>
                <AppText weight="semibold">{item.code}</AppText>
                <AppText color="textSecondary" numberOfLines={1} style={styles.flexShrink}>
                  {item.name}
                </AppText>
              </View>
            }
            trailing={
              item.code === value ? (
                <Icon name="check" size={16} color={tokens.accent} />
              ) : undefined
            }
            onPress={() => onPick(item.code)}
            accessibilityLabel={`${item.name}, ${item.code}`}
          />
        )}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, marginTop: 16 },
  flexShrink: { flexShrink: 1 },
  search: { marginTop: 8, marginHorizontal: 16 },
  list: { marginHorizontal: 16, borderRadius: radii.card, overflow: 'hidden' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
