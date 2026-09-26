import { memo } from 'react';
import { FlatList, Text as RNText, View, type ListRenderItemInfo } from 'react-native';

import type { ProductListItem } from '@sakya/types';
import { useResponsive } from '../../lib/responsive';
import { ProductCard } from '../commerce/ProductCard';

export interface ProductDuoRailProps {
  title: string;
  subtitle?: string;
  products: ProductListItem[];
  onPressProduct: (product: ProductListItem) => void;
  /** Optional "See All" target; the rail renders the link only when set. */
  onSeeAll?: () => void;
  /** Present = card taps open the quick-view sheet instead of navigating. */
  onQuickView?: (product: ProductListItem) => void;
  /** Present = multi-variant ADD opens the variant picker instead of blind-adding. */
  onPickVariant?: (product: ProductListItem) => void;
  /** Hide the "See All" label when there is no single destination for the rail. */
  hideSeeAll?: boolean;
}

/**
 * Product duo rail — a titled, horizontally scrolling section carrying TWO
 * product cards per screen width (the "duo" stop pattern): wider photo wells
 * than the standard rail, so the food reads appetising instead of thumbnail
 * scale. Same behaviour as ProductSection: memoised cards, quick view,
 * variant pick, See All.
 */
function ProductDuoRailInner({
  title,
  subtitle,
  products,
  onPressProduct,
  onSeeAll,
  onQuickView,
  onPickVariant,
  hideSeeAll = false,
}: ProductDuoRailProps) {
  const { contentWidth } = useResponsive();

  if (products.length === 0) return null;

  // Duo geometry: each card ≈ 44% of content width → exactly two cards fully
  // visible with the next one peeking, inviting the horizontal scroll.
  const cardWidth = Math.round(contentWidth * 0.44);

  const renderItem = ({ item }: ListRenderItemInfo<ProductListItem>) => (
    <View style={{ width: cardWidth }}>
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
        {onSeeAll && !hideSeeAll ? (
          <View accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
            <RNText className="text-[12.5px] font-bold text-brand">See All</RNText>
          </View>
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

export const ProductDuoRail = memo(ProductDuoRailInner);
