import { memo } from 'react';
import { FlatList, Pressable, Text as RNText, View, type ListRenderItemInfo } from 'react-native';

import type { ProductListItem } from '@sakya/types';
import { ProductCard } from '../commerce/ProductCard';

export interface ProductSectionProps {
  title: string;
  subtitle?: string;
  products: ProductListItem[];
  onPressProduct: (product: ProductListItem) => void;
  /** Optional "See All" target; the section renders the link only when set. */
  onSeeAll?: () => void;
  /** Present = card taps open the quick-view sheet instead of navigating. */
  onQuickView?: (product: ProductListItem) => void;
  /** Present = multi-variant ADD opens the variant picker instead of blind-adding. */
  onPickVariant?: (product: ProductListItem) => void;
}

/**
 * A titled, horizontally scrolling product section ("Fresh today", …).
 *
 * Horizontal FlatList keeps rendering cheap; cards are memoised so stepper
 * updates in one card never re-render its neighbours.
 */
function ProductSectionInner({ title, subtitle, products, onPressProduct, onSeeAll, onQuickView, onPickVariant }: ProductSectionProps) {
  if (products.length === 0) return null;

  const renderItem = ({ item }: ListRenderItemInfo<ProductListItem>) => (
    <View className="w-[168px]">
      <ProductCard product={item} onPress={onPressProduct} onQuickView={onQuickView} onPickVariant={onPickVariant} />
    </View>
  );

  return (
    <View className="gap-3">
      <View className="flex-row items-end justify-between px-4">
        <View className="gap-0.5">
          <RNText className="text-[17px] font-bold leading-6 text-ink">{title}</RNText>
          {subtitle ? (
            <RNText className="text-[12.5px] leading-4 text-ink-soft">{subtitle}</RNText>
          ) : null}
        </View>
        {onSeeAll ? (
          <Pressable
            onPress={onSeeAll}
            accessibilityRole="button"
            accessibilityLabel={`See all ${title}`}
            hitSlop={8}
          >
            <RNText className="text-[12.5px] font-bold text-brand">See All</RNText>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={products}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={renderItem}
      />
    </View>
  );
}

export const ProductSection = memo(ProductSectionInner);
