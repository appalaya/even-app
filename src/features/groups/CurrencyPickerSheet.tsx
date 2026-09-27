/**
 * The group's currency (Groups, create and join, extra states: "Currency picker"): a sheet 116 from the top over
 * New group, Cancel and "Currency" in its header, a search field ("Search code or name", 4 below the header), then
 * "Common" (the device's currency leads) and "All currencies" (A–Z by code): 48 pt rows padded 20, the code 17/22
 * semibold in a 48 pt column, the name 17/22 in `textSecondary`, a 20 pt accent check on the chosen one;
 * separators from 84. Searching lists every match in one run.
 */
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Icon, Separator, Sheet } from '@/components';
import { radii, typography, useTheme } from '@/theme';

import { currencyName, currencySections, matchesCurrency } from './currencies';

/** The sheet's top edge below the safe area, as drawn (116 − 62). */
const TOP_BELOW_SAFE_AREA = 54;

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
  const sections = useMemo(() => {
    const named = (codes: string[]) => codes.map((code) => ({ code, name: currencyName(code) }));
    const { common, all } = currencySections(deviceCurrency);
    return [
      { title: 'Common', data: named(common) },
      { title: 'All currencies', data: named(all) },
    ];
  }, [deviceCurrency]);
  const searching = query.trim() !== '';
  const shown = searching
    ? [
        {
          title: '',
          data: sections
            .flatMap((section) => section.data)
            .filter((c) => matchesCurrency(c.code, c.name, query)),
        },
      ]
    : sections;

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      top={insets.top + TOP_BELOW_SAFE_AREA}
      leftAction={{ label: 'Cancel', onPress: onDismiss }}
      navTitle="Currency"
      accessibilityLabel="Currency"
    >
      <View style={[styles.search, { backgroundColor: tokens.fill }]}>
        <Icon name="searchList" size={16} color={tokens.iconMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search code or name"
          accessibilityLabel="Search currencies"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          placeholderTextColor={tokens.textMuted}
          selectionColor={tokens.accent}
          cursorColor={tokens.accent}
          style={[typography.body, styles.input, { color: tokens.text }]}
        />
      </View>
      <SectionList
        style={styles.list}
        sections={shown}
        keyExtractor={(c) => c.code}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={() => <Separator inset={84} />}
        renderSectionHeader={({ section }) =>
          section.title === '' ? null : (
            <AppText
              variant="caption"
              weight="semibold"
              color="textSecondary"
              accessibilityRole="header"
              style={styles.header}
            >
              {section.title}
            </AppText>
          )
        }
        renderItem={({ item }) => {
          const chosen = item.code === value;
          return (
            <Pressable
              onPress={() => onPick(item.code)}
              accessibilityRole="radio"
              accessibilityLabel={`${item.name}, ${item.code}`}
              accessibilityState={{ checked: chosen }}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: tokens.rowPressed },
              ]}
            >
              <AppText weight="semibold" style={styles.code}>
                {item.code}
              </AppText>
              <AppText color="textSecondary" numberOfLines={1} style={styles.name}>
                {item.name}
              </AppText>
              {chosen && <Icon name="check" size={20} color={tokens.accent} />}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    marginTop: 4,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    borderRadius: radii.control,
  },
  input: { flex: 1, minWidth: 0, paddingVertical: 0 },
  list: { flex: 1 },
  header: { marginTop: 18, marginBottom: 4, marginHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 48,
    paddingHorizontal: 20,
  },
  code: { width: 48 },
  name: { flex: 1 },
});
