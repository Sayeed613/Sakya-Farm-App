import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const GREEN = '#0B594C';
const WHITE = '#FFFFFF';

export interface DeliveryProgressBarProps {
  /** Cart subtotal in paise. */
  subtotalInPaise: number;
  /** Spend needed for free delivery, in paise. */
  thresholdInPaise?: number;
}

/**
 * The free-delivery progress bar — the single highest-AOV component in
 * quick-commerce. Appears (animated) only when the cart is non-empty, shows
 * remaining spend to the free-delivery threshold, and animates the fill with
 * a spring so each added item produces a visible "progress" reward.
 */
export function DeliveryProgressBar({
  subtotalInPaise,
  thresholdInPaise = 50_000, // ₹500 default until commerce config exposes one
}: DeliveryProgressBarProps) {
  const show = subtotalInPaise > 0;
  const progress = useSharedValue(0);
  const presence = useSharedValue(0);

  useEffect(() => {
    const ratio = Math.min(1, subtotalInPaise / thresholdInPaise);
    progress.value = withSpring(ratio, { damping: 20, stiffness: 160 });
  }, [subtotalInPaise, thresholdInPaise, progress]);

  useEffect(() => {
    presence.value = withTiming(show ? 1 : 0, { duration: 260 });
  }, [show, presence]);

  const fill = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const presenceStyle = useAnimatedStyle(() => ({
    height: presence.value * 44,
    opacity: presence.value,
    marginTop: presence.value * 8,
  }));

  const remaining = Math.max(0, thresholdInPaise - subtotalInPaise);
  const reached = remaining === 0 && subtotalInPaise > 0;

  const format = (paise: number) => `₹${Math.round(paise / 100)}`;

  return (
    <Animated.View
      style={presenceStyle}
      className="overflow-hidden"
      pointerEvents={show ? 'auto' : 'none'}
    >
      <View
        className="mx-4 flex-row items-center gap-2 rounded-2xl px-3"
        style={{ backgroundColor: GREEN, height: 36 }}
      >
        <Ionicons name={reached ? 'checkmark-circle' : 'bicycle'} size={14} color={WHITE} />
        <RNText className="text-[11.5px] font-bold" style={{ color: WHITE }} numberOfLines={1}>
          {reached
            ? 'You’ve unlocked free delivery!'
            : `Add ${format(remaining)} more for free delivery`}
        </RNText>
        {/* Track */}
        <View
          className="ml-auto h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ maxWidth: 90, backgroundColor: 'rgba(255,255,255,0.25)' }}
        >
          <Animated.View
            style={[
              fill,
              { height: '100%', borderRadius: 999, backgroundColor: WHITE },
            ]}
          />
        </View>
      </View>
    </Animated.View>
  );
}
