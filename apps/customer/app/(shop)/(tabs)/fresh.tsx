import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DropdownChip } from '../../../src/components/commerce/DropdownChip';
import {
  hasActiveFilters,
  ListingFilterSheet,
  type AvailabilityFilter,
  type ListingFilterState,
  type SortOption,
} from '../../../src/components/commerce/ListingFilterSheet';
import { ProductCard } from '../../../src/components/commerce/ProductCard';
import { ProductQuickView } from '../../../src/components/commerce/ProductQuickView';
import { VariantPickerSheet, type VariantPickerState } from '../../../src/components/commerce/VariantPickerSheet';
import { AddressSheet } from '../../../src/components/checkout/AddressSheet';
import { StickyCartBar, useCartSummary } from '../../../src/components/commerce/StickyCartBar';
import { CategoryIcon } from '../../../src/components/home/CategoryIcon';
import { ErrorState } from '../../../src/components/ErrorState';
import { SkeletonBlock } from '../../../src/components/LoadingSkeleton';
import { filterByCategory, useFreshCatalog } from '../../../src/hooks/use-fresh-catalog';
import { useDeliveryLocation } from '../../../src/hooks/use-delivery-location';
import { useOpenCategory } from '../../../src/hooks/use-open-category';
import { useOpenProduct } from '../../../src/hooks/use-open-product';
import { useResponsive } from '../../../src/lib/responsive';
import { useAuthStore } from '../../../src/stores/auth-store';
import { useLastAddressStore } from '../../../src/stores/last-address-store';
import type { ProductListItem } from '@sakya/types';

const BOTTOM_NAV_CLEARANCE = 116;

/**
 * Sakya Fresh — the Blinkit-style category listing.
 *
 * Left category sidebar + 2-column product grid + toolbar chips, all over the
 * SAME catalog hook/cache as Home (zero extra requests navigating here). Every
 * product stays browsable: sold-out items render a Notify Me card rather than
 * vanishing. Tapping a card opens the quick-view sheet; the ADD control works
 * inline on the card.
 */
export default function SakyaFreshScreen() {
  const insets = useSafeAreaInsets();
  const { screenPadding } = useResponsive();
  const { itemCount } = useCartSummary();
  const fresh = useFreshCatalog();
  const location = useDeliveryLocation();
  const session = useAuthStore((state) => state.session);
  const lastAddress = useLastAddressStore((state) => state.address);
  const rememberAddress = useLastAddressStore((state) => state.remember);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);

  // Delivery-to affordance: signed-in customers (and guests who already typed
  // an address) see it; guests without one are sent to sign in, so the header
  // never pretends a device-location guess is their delivery address.
  function handleDeliverToPress() {
    if (session === null && lastAddress === null) {
      useAuthStore.getState().setPendingRedirect('/(shop)/fresh');
      router.push('/(auth)/phone');
      return;
    }
    setAddressEditorOpen(true);
  }

  const contactDefaults =
    session && session.user
      ? {
          name: [session.user.firstName, session.user.lastName].filter(Boolean).join(' '),
          phone: session.user.phone ?? '',
        }
      : undefined;

  const [handle, setHandle] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<ListingFilterState>({
    sort: 'Relevance',
    filter: null,
    packFilter: null,
  });
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [quickViewSlug, setQuickViewSlug] = useState<string | null>(null);
  const [variantPick, setVariantPick] = useState<VariantPickerState | null>(null);

  const { sort, filter, packFilter } = filterState;

  const activeCategory = fresh.categories.find((category) => category.slug === handle) ?? null;
  const title = activeCategory?.name ?? 'Sakya Fresh';

  // Pack-size (Type) options: derived from the REAL variant titles of the
  // current category's products. No hardcoded sizes.
  const packOptions = useMemo(() => {
    const base = handle === null ? fresh.produceProducts : filterByCategory(fresh.produceProducts, handle);
    const sizes = new Set<string>();
    for (const product of base) {
      for (const title of product.variantTitles ?? []) {
        if (title.trim().length > 0) sizes.add(title.trim());
      }
    }
    return [...sizes].slice(0, 12);
  }, [fresh.produceProducts, handle]);

  const gridProducts = useMemo(() => {
    // "All Fresh" shows ONLY produce; a selected category filters within it.
    let list = handle === null ? fresh.produceProducts : filterByCategory(fresh.produceProducts, handle);
    if (packFilter != null) {
      list = list.filter((product) => (product.variantTitles ?? []).some((title) => title.trim() === packFilter));
    }
    if (filter === 'In stock') {
      list = list.filter((product) => product.isAvailable && product.availableVariantCount > 0);
    } else if (filter === 'On sale') {
      list = list.filter(
        (product) =>
          product.compareAtMaxInPaise != null &&
          product.price?.minInPaise != null &&
          product.compareAtMaxInPaise > product.price.minInPaise,
      );
    }
    const byPrice = (product: ProductListItem) => product.price?.minInPaise ?? Number.MAX_SAFE_INTEGER;
    if (sort === 'Price: low to high') list = [...list].sort((a, b) => byPrice(a) - byPrice(b));
    if (sort === 'Price: high to low') list = [...list].sort((a, b) => byPrice(b) - byPrice(a));
    if (sort === 'Freshness') {
      list = [...list].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    }
    return list;
  }, [fresh.products, fresh.produceProducts, handle, filter, sort, packFilter]);

  const openProduct = useOpenProduct();
  // Prefetch-on-tap: warms the category listing's shared key before the push.
  const openCategory = useOpenCategory();
  const openCart = useCallback(() => router.push('/(shop)/cart'), []);

  const selectCategory = useCallback((slug: string | null) => {
    setHandle(slug);
  }, []);

  const filterActive = hasActiveFilters(filterState);
  const clearFilters = useCallback(
    () => setFilterState({ sort: 'Relevance', filter: null, packFilter: null }),
    [],
  );

  // The quick-view pager: the current grid IS the deck — swipe left/right to
  // step through exactly these products.
  const surfaceProducts = useMemo(() => gridProducts, [gridProducts]);

  // Cross-sell context for the quick view: the grid minus the viewed product.
  const relatedProducts = useMemo(
    () => surfaceProducts.filter((product) => product.slug !== quickViewSlug).slice(0, 10),
    [surfaceProducts, quickViewSlug],
  );

  if (fresh.isError) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <ErrorState
          title="Could not load the farm"
          message="We could not reach the farm right now. Check your connection and try again."
          onRetry={fresh.refetch}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View className="flex-row items-center gap-1 px-3 pb-1.5 pt-2">
        <View className="flex-1 pl-1">
          <RNText className="text-[17px] font-bold leading-5 text-ink" numberOfLines={1}>
            {title}
          </RNText>
          {/* Delivery address: saved address → sign-in prompt for guests →
              device location. Tappable, same flows the Home header uses. */}
          <Pressable
            onPress={handleDeliverToPress}
            accessibilityRole="button"
            accessibilityLabel="Change delivery address"
            hitSlop={4}
            className="mt-0.5 flex-row items-center gap-1"
          >
            <Ionicons name="location" size={11} color="#0B594C" />
            <RNText className="flex-1 text-[11.5px] font-semibold text-brand" numberOfLines={1}>
              {lastAddress !== null
                ? `Deliver to: ${shortAddressLabel(lastAddress)}`
                : session === null
                  ? 'Sign in to set delivery address'
                  : `Delivering to: ${location.status === 'locating' ? 'Locating…' : location.label}`}
            </RNText>
            <Ionicons name="chevron-down" size={11} color="#0B594C" />
          </Pressable>
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

      {fresh.isLoading ? (
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
        <>
          {/* ── Sidebar + grid ─────────────────────────────────────────────── */}
          <View className="flex-1 flex-row">
            {/* Left sidebar scrolls independently of the grid. */}
            <View className="w-[92px] border-r border-line">
              <FlatList
                data={fresh.categories}
                keyExtractor={(category) => category.slug}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 6, gap: 6 }}
                ListHeaderComponent={
                  <CategoryIcon
                    slug="leaf"
                    label="All Fresh"
                    shape="circle"
                    compact
                    imageSet="sakya-fresh"
                    active={handle === null}
                    onPress={() => selectCategory(null)}
                  />
                }
                renderItem={({ item }) => (
                  <CategoryIcon
                    slug={item.slug}
                    label={item.name}
                    shape="circle"
                    compact
                    imageSet="sakya-fresh"
                    active={handle === item.slug}
                    onPress={() => selectCategory(item.slug)}
                  />
                )}
              />
            </View>

            {/* Main column: editorial heading, toolbar chips, grid. The
                sort/filter UI is a bottom sheet (ListingFilterSheet) rendered
                at screen level — no anchored menus to clip or cover. */}
            <View className="flex-1">
              {/* Editorial band: category metadata when the backend has it,
                  minimal brand copy otherwise. No invented claims. */}
              <View className="px-3 pb-0.5 pt-2">
                <RNText className="text-[18px] font-bold leading-6 text-ink">
                  {activeCategory?.name ?? 'Sakya Fresh'}
                </RNText>
                <RNText className="mt-0.5 text-[12.5px] leading-4 text-ink-soft">
                  {activeCategory?.description ?? 'Harvested, packed and shipped — straight from our fields.'}
                </RNText>
              </View>

              {/* Toolbar row — one Sort & filter entry opens the redesigned
                  bottom sheet; a Clear chip appears only when something is
                  active. */}
              <View className="pb-1 pt-1.5">
                <View className="flex-row items-center gap-1.5 px-3">
                  <DropdownChip
                    label="Sort & filter"
                    active={filterActive}
                    onPress={() => setFilterSheetOpen(true)}
                  />
                  {filterActive ? (
                    <Pressable
                      onPress={clearFilters}
                      accessibilityRole="button"
                      accessibilityLabel="Clear all filters"
                      hitSlop={6}
                      className="flex-row items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 active:opacity-70"
                    >
                      <Ionicons name="close-circle" size={12} color="#B4612F" />
                      <RNText className="text-[12px] font-semibold" style={{ color: '#B4612F' }}>
                        Clear
                      </RNText>
                    </Pressable>
                  ) : null}
                  <View className="flex-1" />
                  <RNText className="text-[11.5px] font-semibold text-ink-soft">
                    {gridProducts.length} item{gridProducts.length === 1 ? '' : 's'}
                  </RNText>
                </View>
              </View>

              <FlatList
                data={gridProducts}
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
                ListFooterComponent={
                  <Pressable
                    onPress={() => selectCategory(null)}
                    accessibilityRole="button"
                    accessibilityLabel="See all products"
                    className="mx-3 mt-2 flex-row items-center justify-center gap-1.5 rounded-2xl border border-line bg-white py-3"
                  >
                    <RNText className="text-[13px] font-bold text-brand">See all products</RNText>
                    <Ionicons name="chevron-forward" size={14} color="#0B594C" />
                  </Pressable>
                }
              />
            </View>
          </View>

          {/* Sticky cart pill above the bottom nav. */}
          <StickyCartBar itemCount={itemCount} onPress={openCart} />
        </>
      )}

      {/* Redesigned sort/filter bottom sheet (sort, availability, pack size,
          Clear all). Replaces the old screen-level dropdown menus. */}
      <ListingFilterSheet
        visible={filterSheetOpen}
        state={filterState}
        packOptions={packOptions}
        resultCount={gridProducts.length}
        onSortChange={(next: SortOption) => setFilterState((current) => ({ ...current, sort: next }))}
        onFilterChange={(next: AvailabilityFilter | null) =>
          setFilterState((current) => ({ ...current, filter: next }))
        }
        onPackChange={(next: string | null) => setFilterState((current) => ({ ...current, packFilter: next }))}
        onClearAll={clearFilters}
        onClose={() => setFilterSheetOpen(false)}
      />

      {/* Address editor — the same sheet the Home header uses; guests who
          already have a typed address can refine it here too. */}
      <AddressSheet
        visible={addressEditorOpen}
        initial={lastAddress}
        contactDefaults={contactDefaults}
        canSaveToBook={session !== null}
        onClose={() => setAddressEditorOpen(false)}
        onSave={(address) => {
          rememberAddress(address);
          setAddressEditorOpen(false);
        }}
      />

      {/* Quick-view sheet (native modal, not a route push). */}
      <ProductQuickView
        slug={quickViewSlug}
        onClose={() => setQuickViewSlug(null)}
        pagerProducts={surfaceProducts}
        relatedProducts={relatedProducts}
        onOpenProduct={(slug) => {
          setQuickViewSlug(null);
          openProduct(slug);
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

/**
 * "Home · #233 1st Cross" — tag plus the first few words of the street, for
 * the Deliver-to line. Mirrors the Home header's helper so both surfaces
 * label the same address identically.
 */
function shortAddressLabel(address: {
  line1: string;
  line2?: string;
  landmark?: string;
}): string {
  const street = [address.line1, address.line2 ?? '', address.landmark ?? '']
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const short = (street[0] ?? '').split(/\s+/).slice(0, 4).join(' ');
  const tag = /office|work/i.test(short)
    ? 'Office'
    : /flat|apt|apartment/i.test(short)
      ? 'Flat'
      : 'Home';
  return short !== '' ? `${tag} · ${short}` : tag;
}
