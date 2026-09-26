import { CATEGORY_EMOJI, CATEGORY_LABEL } from '@even/core';
import { StyleSheet, View } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';

import { CategoryChip } from '@/components';
import { strokes, useTheme } from '@/theme';

import type { ChipState } from './chipMachine';

/** The model changed the chip: it fades in from a touch smaller, so a change you did not make is never invisible. */
const SWAP = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.9 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(260);

/**
 * The category chip beside the title. Kit states: `suggested` (keyword or model, with the tag), `chosen` (yours), and
 * `choosing` while the picker is open. The kit's `choosing` always carries the "suggested" tag, as the picker board
 * draws it over a suggestion; for a chip you already chose, the ring is drawn around the `chosen` chip here instead.
 */
export function ChipSlot({
  chip,
  choosing,
  onPress,
}: {
  chip: ChipState;
  choosing: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  const user = chip.source === 'user';
  const emoji = CATEGORY_EMOJI[chip.category];
  const label = CATEGORY_LABEL[chip.category];
  const body =
    choosing && user ? (
      <View
        style={[styles.ring, { boxShadow: `0 0 0 ${strokes.ring}px ${tokens.accent}` }]}
        accessibilityState={{ expanded: true }}
      >
        <CategoryChip emoji={emoji} label={label} state="chosen" onPress={onPress} />
      </View>
    ) : (
      <CategoryChip
        emoji={emoji}
        label={label}
        state={choosing ? 'choosing' : user ? 'chosen' : 'suggested'}
        onPress={onPress}
      />
    );
  return (
    <Animated.View key={chip.swaps} entering={chip.swaps > 0 ? SWAP : undefined}>
      {body}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: { borderRadius: 20 },
});
