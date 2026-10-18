import { useEffect, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

/**
 * Product words that rotate inside the home search pill. "Search for" stays
 * constant; the word rises in, holds, and is replaced — the quick-commerce
 * placeholder pattern (Blinkit/Zepto) that advertises the catalogue without
 * stealing a tap target. Kept short so the longest word still fits one line
 * next to the mic icon on a 320dp phone.
 */
const WORDS = ['ghee', 'cold-pressed oils', 'pickles', 'honey', 'fresh fruits', 'vegetables'] as const;

/** Hold time per word — long enough to read, short enough to feel alive. */
const ROTATE_MS = 2_200;

const HINT_COLOR = 'rgba(255,255,255,0.92)';

/**
 * The animated half of the search pill's placeholder. Purely decorative —
 * the pill keeps a static `accessibilityLabel`, so screen readers never
 * announce a word that changes under them.
 */
export function RotatingSearchHint() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % WORDS.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const word = WORDS[index];

  return (
    <View className="flex-1 flex-row items-center overflow-hidden">
      <RNText className="text-[13.5px]" style={{ color: HINT_COLOR }}>
        Search for{''}
      </RNText>
      {/* Keyed mount: each word fades/slides up once as it arrives (the old
          word leaves instantly — no overlap, no width fight). The explicit
          margin is the visible word-gap: relying on a trailing space alone
          renders as "Search forhoney" on Android. */}
      <Animated.View key={word} entering={FadeInDown.duration(300)} style={{ marginLeft: 6 }}>
        <RNText className="text-[13.5px] font-semibold" style={{ color: HINT_COLOR }} numberOfLines={1}>
          {word}
        </RNText>
      </Animated.View>
    </View>
  );
}
