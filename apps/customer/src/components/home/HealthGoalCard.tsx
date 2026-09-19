import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Text as RNText, View } from 'react-native';

import { AnimatedPressable, usePressScale } from '../../lib/motion';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#6F6C63';

export interface HealthGoalCardProps {
  title: string;
  description: string;
  icon: string;
  /** Distinct terracotta tint per goal, part of the spice palette. */
  tint: string;
  onPress: () => void;
}

/**
 * A health-goal guide card — deliberately NOT a product card: icon, label,
 * one-line description, tap through to the curated collection. Feels like an
 * editorial entry point rather than a grid tile.
 */
function HealthGoalCardInner({ title, description, icon, tint, onPress }: HealthGoalCardProps) {
  const press = usePressScale();
  const glyph = icon as keyof typeof Ionicons.glyphMap;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${description}`}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="w-[150px] rounded-2xl border border-line bg-white p-3.5"
    >
      <View
        className="mb-2.5 h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: tint }}
      >
        <Ionicons name={glyph} size={18} color={BRAND} />
      </View>
      <RNText className="text-[14px] font-bold leading-4.5" style={{ color: INK }}>
        {title}
      </RNText>
      <RNText className="mt-1 text-[11.5px] leading-4" style={{ color: MUTED }} numberOfLines={2}>
        {description}
      </RNText>
    </AnimatedPressable>
  );
}

export const HealthGoalCard = memo(HealthGoalCardInner);
