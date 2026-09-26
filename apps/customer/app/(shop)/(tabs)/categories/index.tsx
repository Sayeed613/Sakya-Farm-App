import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, View as RNView } from 'react-native';
import { useCallback, useState } from 'react';

import { catalogApi } from '../../../../src/api/catalog';
import { CategoryCollageTile } from '../../../../src/components/commerce/CategoryCollageTile';
import { ErrorState } from '../../../../src/components/ErrorState';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Text } from '../../../../src/components/Text';
import { buildCollagePhotosByHandle } from '../../../../src/lib/collage-photos';
import { useResponsive } from '../../../../src/lib/responsive';
import { colors } from '../../../../src/theme';

/** Grid geometry — identical to home's discovery grids. */
const COLUMNS = 3;
const TILE_GAP = 10;
const LIST_TOP = 12;
/** Clearance above the floating bottom tab bar. */
const TAB_BAR_CLEARANCE = 116;

/**
 * Categories tab: every purchasable category as a 2×2 product-photo collage
 * tile (Blinkit listing pattern), 3 responsive columns, centred labels —
 * the same shared tile home's discovery grids render, so a category looks
 * identical wherever it appears. Taps open the category listing.
 */
export default function Categories() {
  const router = useRouter();
  const categories = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: catalogApi.listCategories,
  });
  const products = useQuery({
    queryKey: ['catalog', 'products', 'home-all'],
    queryFn: () => catalogApi.listProducts({ limit: 100 }),
    staleTime: 60_000,
  });

  const [refreshing, setRefreshing] = useState(false);
  const { screenPadding, gridTileWidth } = useResponsive();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([categories.refetch(), products.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [categories, products]);

  if (categories.isLoading) return <LoadingState />;
  if (categories.isError) {
    return <ErrorState message="We could not load categories." onRetry={() => void categories.refetch()} />;
  }

  // Photos per handle for the collages — the same shared builder home uses,
  // served from the same ['catalog', 'products', 'home-all'] cache.
  const photosByHandle = buildCollagePhotosByHandle(products.data?.items ?? []);

  return (
    <RNView className="flex-1 bg-canvas">
      <FlatList
        data={categories.data ?? []}
        keyExtractor={(item) => item.slug}
        numColumns={COLUMNS}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: screenPadding,
          paddingTop: LIST_TOP,
          paddingBottom: TAB_BAR_CLEARANCE,
          gap: 14,
        }}
        columnWrapperStyle={{ gap: TILE_GAP, justifyContent: 'center' }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <Text variant="title" className="pb-3">
            Categories
          </Text>
        }
        ListEmptyComponent={
          <Text color={colors.textMuted}>No categories are available.</Text>
        }
        renderItem={({ item }) => (
          <CategoryCollageTile
            name={item.name}
            count={item.productCount}
            imageUris={photosByHandle.get(item.slug) ?? []}
            width={gridTileWidth}
            onPress={() => router.push(`/(shop)/categories/${item.slug}`)}
          />
        )}
      />
    </RNView>
  );
}
