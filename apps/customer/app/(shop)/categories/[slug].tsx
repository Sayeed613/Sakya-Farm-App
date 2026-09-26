import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { catalogApi } from '../../../src/api/catalog';
import { ProductCard } from '../../../src/components/commerce/ProductCard';
import { ProductQuickView } from '../../../src/components/commerce/ProductQuickView';
import {
  VariantPickerSheet,
  type VariantPickerState,
} from '../../../src/components/commerce/VariantPickerSheet';
import { StickyCartBar, useCartSummary } from '../../../src/components/commerce/StickyCartBar';
import { ErrorState } from '../../../src/components/ErrorState';
import { SkeletonBlock } from '../../../src/components/LoadingSkeleton';
import { goBackOrHome } from '../../../src/lib/navigation';
import { useResponsive } from '../../../src/lib/responsive';
import type { CategorySummary, ProductListItem } from '@sakya/types';

const BOTTOM_NAV_CLEARANCE = 116;

/**
 * Category listing — same product experience as Sakya Fresh, scoped to one
 * category: header with the real category name, 2-column ProductCard grid
 * (badges, inline ADD/stepper), quick-view sheet, variant picker and the
 * sticky cart pill. Navigating from Home lands here instead of a bare list.
 */
export default function CategoryProducts() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const { itemCount } = useCartSummary();
  const { screenPadding } = useResponsive();

  const [quickViewSlug, setQuickViewSlug] = useState<string | null>(null);
  const [variantPick, setVariantPick] = useState<VariantPickerState | null>(null);

  const products = useQuery({
    queryKey: ['catalog', 'category', slug],
    queryFn: () => catalogApi.listCategoryProducts(slug),
    enabled: Boolean(slug),
  });

  // Reuse the home categories cache when it exists (no extra request); fall
  // back to a direct fetch so a cold entry here still shows the real name.
  const category = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: catalogApi.listCategories,
    staleTime: 5 * 60_000,
  });

  const categoryInfo: CategorySummary | null = useMemo(
    () => category.data?.find((candidate) => candidate.slug === slug) ?? null,
    [category.data, slug],
  );

  const items = useMemo<ProductListItem[]>(() => products.data?.items ?? [], [products.data]);

  const openProduct = useCallback(
    (nextSlug: string) => router.push(`/(shop)/products/${nextSlug}`),
    [],
  );

  const openCategory = useCallback(
    (categorySlug: string) => router.push(`/(shop)/categories/${categorySlug}`),
    [],
  );

  const openCart = useCallback(() => router.push('/(shop)/cart'), []);

  // The quick-view pager: the current grid IS the deck — swiping steps
  // through exactly these products.
  const surfaceProducts = useMemo(() => items, [items]);

  // Cross-sell context for the quick view: the grid minus the viewed product.
  const relatedProducts = useMemo(
    () => surfaceProducts.filter((product) => product.slug !== quickViewSlug).slice(0, 10),
    [surfaceProducts, quickViewSlug],
  );

  const title = categoryInfo?.name ?? slug;

  if (products.isError) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <ErrorState
          title="Could not load this category"
          message="We could not reach the farm right now. Check your connection and try again."
          onRetry={() => void products.refetch()}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View className="flex-row items-center gap-1 px-3 pb-1.5 pt-2">
        <Pressable
          onPress={goBackOrHome}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          className="h-9 w-9 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color="#171A18" />
        </Pressable>
        <View className="flex-1">
          <RNText className="text-[17px] font-bold leading-5 text-ink" numberOfLines={1}>
            {title}
          </RNText>
          {categoryInfo?.description ? (
            <RNText className="text-[11.5px] leading-4 text-ink-soft" numberOfLines={1}>
              {categoryInfo.description}
            </RNText>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.push('/search')}
          accessibilityRole="button"
          accessibilityLabel="Search products"
          hitSlop={8}
          className="h-9 w-9 items-center justify-center"
        >
          <Ionicons name="search" size={19} color="#171A18" />
        </Pressable>
      </View>

      {products.isLoading ? (
        <View className="flex-row flex-wrap justify-between gap-y-4 px-4 py-4">
          {[0, 1, 2, 3].map((index) => (
            <View key={index} className="w-[48.5%] gap-2">
              <SkeletonBlock className="aspect-square w-full rounded-2xl" />
              <SkeletonBlock className="h-3.5 w-3/4" />
              <SkeletonBlock className="h-3.5 w-1/2" />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(product) => product.id}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: screenPadding }}
          contentContainerStyle={{
            paddingBottom: BOTTOM_NAV_CLEARANCE + 52,
            paddingTop: 6,
            gap: 12,
            paddingHorizontal: 2,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View className="px-3 pb-2 pt-1">
              <RNText className="text-[18px] font-bold leading-6 text-ink">{title}</RNText>
              <RNText className="mt-0.5 text-[12.5px] leading-4 text-ink-soft">
                {categoryInfo?.description ?? 'Harvested, packed and shipped — straight from our fields.'}
              </RNText>
            </View>
          }
          ListEmptyComponent={
            <View className="items-center gap-2 px-6 py-14">
              <Ionicons name="leaf-outline" size={34} color="#D2C4AE" />
              <RNText className="text-[15px] font-semibold text-ink">Nothing here yet</RNText>
              <RNText className="text-center text-[13px] leading-5 text-ink-soft">
                This shelf is being restocked. Try another category.
              </RNText>
            </View>
          }
          renderItem={({ item }) => (
            <View className="w-[48.5%]">
              <ProductCard
                product={item}
                variant="grid"
                onPress={(selected) => openProduct(selected.slug)}
                onQuickView={(selected) => setQuickViewSlug(selected.slug)}
                onPickVariant={(selected) => setVariantPick({ product: selected })}
              />
            </View>
          )}
        />
      )}

      {/* Sticky cart pill above the bottom nav. */}
      <StickyCartBar itemCount={itemCount} onPress={openCart} />

      {/* Quick-view sheet (native modal, not a route push). */}
      <ProductQuickView
        slug={quickViewSlug}
        onClose={() => setQuickViewSlug(null)}
        pagerProducts={surfaceProducts}
        relatedProducts={relatedProducts}
        onOpenProduct={(nextSlug) => {
          setQuickViewSlug(null);
          openProduct(nextSlug);
        }}
        onOpenCategory={(categorySlug) => {
          setQuickViewSlug(null);
          openCategory(categorySlug);
        }}
      />
      <VariantPickerSheet pick={variantPick} onClose={() => setVariantPick(null)} />
    </View>
  );
}
