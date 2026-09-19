import { memo } from 'react';
import { FlatList, Pressable, Text as RNText, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import type { CategorySummary } from '@sakya/types';
import { CategoryCard } from './CategoryCard';

export interface CategoryRailProps {
  categories: CategorySummary[];
  onPressCategory: (category: CategorySummary) => void;
  /** Navigate to the full categories screen. */
  onViewAll: () => void;
}

/** Horizontal rail of category tiles with a section header and View all. */
function CategoryRailInner({ categories, onPressCategory, onViewAll }: CategoryRailProps) {
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between px-4">
        <RNText className="text-[17px] font-bold text-ink">Shop by category</RNText>
        <Pressable
          onPress={onViewAll}
          accessibilityRole="button"
          accessibilityLabel="View all categories"
          hitSlop={8}
        >
          <RNText className="text-[12.5px] font-bold text-brand">View all</RNText>
        </Pressable>
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={categories}
        keyExtractor={(item) => item.slug}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.duration(260).delay(index * 50)}>
            <CategoryCard category={item} onPress={onPressCategory} />
          </Animated.View>
        )}
      />
    </View>
  );
}

export const CategoryRail = memo(CategoryRailInner);
