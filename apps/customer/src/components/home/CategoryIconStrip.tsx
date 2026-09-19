import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { FlatList, Text as RNText, View } from 'react-native';

import type { CategorySummary } from '@sakya/types';
import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from '../../config/category-icons';
import { getCategoryImage } from '../../config/category-images';
import { AnimatedPressable, usePressScale } from '../../lib/motion';

const BRAND = '#0B594C';
const INK = '#171A18';

export interface CategoryIconStripProps {
  categories: CategorySummary[];
  onPress: (category: CategorySummary) => void;
}

/** One quick icon: glyph tile + label, tappable through to the category. */
function CategoryIcon({ category, onPress }: { category: CategorySummary; onPress: CategoryIconStripProps['onPress'] }) {
  const press = usePressScale();
  const image = getCategoryImage(category.slug);
  const icon = (CATEGORY_ICONS[category.slug] ?? FALLBACK_CATEGORY_ICON) as keyof typeof Ionicons.glyphMap;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${category.productCount} products`}
      onPress={() => onPress(category)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="w-[72px] items-center gap-1.5"
    >
      <View className="h-[60px] w-[60px] items-center justify-center overflow-hidden rounded-2xl border border-line bg-white">
        {image ? (
          <Image
            source={image}
            // Explicit style, NOT className: expo-image has no cssInterop
            // registration in this app, so NativeWind classes are ignored on
            // it and a class-sized image renders 0x0 (invisible).
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            // The artwork PNGs are large (100-500KB); expo-image downsamples
            // to the 60px tile and caches the decode, so the strip snaps in
            // instead of re-decoding every mount.
            cachePolicy="memory"
            recyclingKey={category.slug}
            transition={100}
          />
        ) : (
          <Ionicons name={icon} size={24} color={BRAND} />
        )}
      </View>
      <RNText className="text-center text-[11px] font-semibold leading-3.5" style={{ color: INK }} numberOfLines={2}>
        {category.name}
      </RNText>
    </AnimatedPressable>
  );
}

/** Horizontally scrollable quick-icon strip, one icon per category. */
function CategoryIconStripInner({ categories, onPress }: CategoryIconStripProps) {
  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={categories}
      keyExtractor={(item) => item.slug}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingVertical: 4 }}
      renderItem={({ item }) => <CategoryIcon category={item} onPress={onPress} />}
    />
  );
}

export const CategoryIconStrip = memo(CategoryIconStripInner);
