import { CATEGORY_EMOJI, CATEGORY_LABEL } from '@even/core';
import Animated, { Keyframe } from 'react-native-reanimated';

import { CategoryChip } from '@/components';

import type { ChipState } from './chipMachine';

/** The model changed the chip: it fades in from a touch smaller, so a change you did not make is never invisible. */
const SWAP = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.9 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(260);

/**
 * The category chip beside the title (Add expense, extra states: "Category chip"):
 * - no title yet and nothing chosen: the dashed "Category" placeholder;
 * - a keyword match: no mark;
 * - the model's pick, not yet touched (`chip.tagged`): the sparkle after the label, with no timer; when the model
 *   changes the chip the swap animates;
 * - chosen by you: looks the same as a keyword chip, never re-inferred; choosing over the model's pick fades the
 *   sparkle out (250 ms, `CategoryChip`).
 * While the picker is open the chip carries the 2 pt accent ring (Category picker open).
 */
export function ChipSlot({
  chip,
  title,
  choosing,
  onPress,
}: {
  chip: ChipState;
  /** The title field's text: an empty title (and no choice of yours) shows the placeholder. */
  title: string;
  choosing: boolean;
  onPress: () => void;
}) {
  const placeholder = chip.source !== 'user' && title.trim() === '';
  const state = placeholder
    ? 'placeholder'
    : chip.source === 'user'
      ? 'chosen'
      : chip.tagged
        ? 'suggested'
        : 'inferred';
  return (
    <Animated.View key={chip.swaps} entering={chip.swaps > 0 ? SWAP : undefined}>
      <CategoryChip
        emoji={CATEGORY_EMOJI[chip.category]}
        label={CATEGORY_LABEL[chip.category]}
        state={state}
        choosing={choosing}
        onPress={onPress}
      />
    </Animated.View>
  );
}
