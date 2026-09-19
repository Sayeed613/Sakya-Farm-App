import { Ionicons } from '@expo/vector-icons';
import { Text as RNText } from 'react-native';

import { AnimatedPressable, usePressScale } from '../../lib/motion';

export interface SearchBarProps {
  placeholder?: string;
  /** Opens the real search route; rendered as a styled, pressable surface. */
  onPress: () => void;
}

/**
 * The prominent search entry. It is a button, not an input: pressing navigates
 * to the search route (Blinkit-style), which keeps Home renders cheap and the
 * keyboard state simple. The same component hosts a real input later on the
 * search screen itself.
 */
export function SearchBar({ placeholder = 'Search pickles, oils, ghee, produce & more', onPress }: SearchBarProps) {
  const press = usePressScale();

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={placeholder}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="mx-4 flex-row items-center gap-2.5 rounded-2xl border border-line bg-white px-4"
    >
      <Ionicons name="search" size={18} color="#0B594C" />
      <RNText className="flex-1 py-3.5 text-[14px] text-ink-soft" numberOfLines={1}>
        {placeholder}
      </RNText>
    </AnimatedPressable>
  );
}
