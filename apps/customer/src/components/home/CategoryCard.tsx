import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Image, Text as RNText, View } from 'react-native';

import type { CategorySummary } from '@sakya/types';
import { AnimatedPressable, usePressScale } from '../../lib/motion';

export interface CategoryCardProps {
  category: CategorySummary;
  onPress: (category: CategorySummary) => void;
  /** First rail item animates in first; the rail staggers via delay. */
  entering?: object;
}

/**
 * One category tile: image where the API supplies one, name, product count.
 *
 * The list API carries no category imagery, so tiles use a restrained
 * botanical-icon treatment on the muted surface — real structure, no invented
 * artwork. Image support is wired for the day the API returns images.
 */
function CategoryCardInner({ category, onPress }: CategoryCardProps) {
  const press = usePressScale();
  const imageUrl = undefined; // CategorySummary has no image field today.

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${category.productCount} products`}
      onPress={() => onPress(category)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="w-[84px] items-center gap-1.5"
    >
      <View className="h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface">
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} className="h-full w-full" resizeMode="cover" />
        ) : (
          <Ionicons name="leaf-outline" size={26} color="#0B594C" />
        )}
      </View>
      <View className="items-center">
        <RNText
          className="text-center text-[12px] font-semibold leading-4 text-ink"
          numberOfLines={2}
        >
          {category.name}
        </RNText>
        <RNText className="text-[10.5px] leading-3.5 text-ink-soft">
          {category.productCount}
        </RNText>
      </View>
    </AnimatedPressable>
  );
}

export const CategoryCard = memo(CategoryCardInner);
