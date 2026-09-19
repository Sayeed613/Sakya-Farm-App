import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { catalogApi } from '../src/api/catalog';
import { EmptyState } from '../src/components/EmptyState';
import { ProductCard } from '../src/components/commerce/ProductCard';
import { ProductQuickView } from '../src/components/commerce/ProductQuickView';
import { VariantPickerSheet, type VariantPickerState } from '../src/components/commerce/VariantPickerSheet';
import { ErrorState } from '../src/components/ErrorState';
import { SkeletonBlock } from '../src/components/LoadingSkeleton';
import { colors } from '../src/theme';

/**
 * Search — real API-backed product search.
 *
 * Lives OUTSIDE the (shop) tab group (root stack screen): it opens above the
 * tabs with its own back button, so it never registers as a tab route —
 * a structural guarantee that it can never appear in the bottom navbar.
 *
 * Debounced (350 ms) against the same paginated `/products` endpoint the
 * catalogue uses; no client-side filtering of a downloaded catalog.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [quickViewSlug, setQuickViewSlug] = useState<string | null>(null);
  const [variantPick, setVariantPick] = useState<VariantPickerState | null>(null);

  // Debounce the raw input before it hits the API.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery.trim()), 350);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const results = useQuery({
    queryKey: ['catalog', 'products', 'search', query],
    queryFn: () => catalogApi.listProducts({ search: query, availability: 'available' }),
    enabled: query.length > 0,
    placeholderData: (previous) => previous,
  });

  const openProduct = (slug: string) => router.push(`/(shop)/products/${slug}`);

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-2">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          className="h-10 w-10 items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View className="flex-1 flex-row items-center gap-2 rounded-2xl border border-line bg-white px-3.5">
          <Ionicons name="search" size={17} color="#8C8A80" />
          <TextInput
            value={rawQuery}
            onChangeText={setRawQuery}
            placeholder="Search pickles, oils, ghee, produce & more"
            placeholderTextColor="#8C8A80"
            autoFocus
            returnKeyType="search"
            className="flex-1 py-3 text-[14px] text-ink"
            accessibilityLabel="Search products"
          />
          {rawQuery.length > 0 ? (
            <Pressable
              onPress={() => {
                setRawQuery('');
                setQuery('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={17} color="#8C8A80" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {query.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Ionicons name="search-outline" size={36} color="#D2C4AE" />
          <RNText className="text-center text-[14px] leading-5 text-ink-soft">
            Search for pickles, cold-pressed oils, ghee, honey, grains — anything from the farms.
          </RNText>
        </View>
      ) : results.isPending ? (
        <View className="flex-row flex-wrap justify-between gap-y-3 px-4 py-3">
          {[0, 1, 2, 3].map((index) => (
            <View key={index} className="w-[48.5%] gap-2">
              <SkeletonBlock className="aspect-square w-full rounded-2xl" />
              <SkeletonBlock className="h-3.5 w-3/4" />
              <SkeletonBlock className="h-3.5 w-1/2" />
            </View>
          ))}
        </View>
      ) : results.isError ? (
        <ErrorState
          title="Search failed"
          message="We could not search just now. Check your connection and try again."
          onRetry={() => void results.refetch()}
        />
      ) : (results.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          image={require('../src/assets/no-result-found.png')}
          title="Nothing found"
          message={`No products match “${query}”. Try a different word.`}
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <RNText className="px-4 pb-1 pt-2 text-[12.5px] text-ink-soft">
            {results.data?.items.length} result{results.data?.items.length === 1 ? '' : 's'}
          </RNText>
          <View className="flex-row flex-wrap justify-between gap-y-3 px-4">
            {results.data?.items.map((product) => (
              <View key={product.id} className="w-[48.5%]">
                <ProductCard
                  product={product}
                  variant="grid"
                  onPress={(item) => openProduct(item.slug)}
                  onQuickView={(item) => setQuickViewSlug(item.slug)}
                  onPickVariant={(item) => setVariantPick({ product: item })}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <ProductQuickView
        slug={quickViewSlug}
        onClose={() => setQuickViewSlug(null)}
        pagerProducts={results.data?.items ?? []}
        relatedProducts={(results.data?.items ?? [])
          .filter((item) => item.slug !== quickViewSlug)
          .slice(0, 10)}
        onOpenProduct={(slug) => {
          setQuickViewSlug(null);
          openProduct(slug);
        }}
      />
      <VariantPickerSheet pick={variantPick} onClose={() => setVariantPick(null)} />
    </View>
  );
}
