import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotionSafe } from '../lib/motion-safe';

/**
 * Skeleton primitives.
 *
 * A single pulse driver is shared via context-free props; each block pulses on
 * its own timeline (cheap, no layout thrash) and stops entirely when the OS
 * reports reduced motion. Blocks match the real layout so data arriving never
 * shifts anything.
 */

export function SkeletonBlock({ className = '' }: { className?: string }) {
  const reduceMotion = useReducedMotionSafe();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withSequence(withTiming(0.55, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
      true,
    );
  }, [pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={style}
      className={'rounded-xl bg-surface-muted ' + className}
    />
  );
}

/** Mirrors the Home layout: header, search, hero, category rail, product grid. */
export function HomeSkeleton() {
  return (
    <View className="flex-1 gap-5 px-4 pb-6 pt-2">
      <SkeletonBlock className="h-9 w-full" />
      <SkeletonBlock className="h-12 w-full rounded-2xl" />
      <SkeletonBlock className="h-40 w-full rounded-2xl" />
      <View className="gap-3">
        <SkeletonBlock className="h-5 w-40" />
        <View className="flex-row gap-3">
          {[0, 1, 2, 3].map((index) => (
            <SkeletonBlock key={index} className="h-20 w-20 rounded-2xl" />
          ))}
        </View>
      </View>
      <View className="gap-3">
        <SkeletonBlock className="h-5 w-32" />
        <View className="flex-row gap-3">
          <View className="flex-1 gap-2">
            <SkeletonBlock className="aspect-square w-full rounded-2xl" />
            <SkeletonBlock className="h-3.5 w-3/4" />
            <SkeletonBlock className="h-3.5 w-1/2" />
          </View>
          <View className="flex-1 gap-2">
            <SkeletonBlock className="aspect-square w-full rounded-2xl" />
            <SkeletonBlock className="h-3.5 w-3/4" />
            <SkeletonBlock className="h-3.5 w-1/2" />
          </View>
        </View>
      </View>
    </View>
  );
}
