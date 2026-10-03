import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text as RNText,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BANNER_H, BANNER_W, PEEK } from '../../../src/components/home/HeroCarousel';
import { useResponsive } from '../../../src/lib/responsive';
import { StatusBar } from 'expo-status-bar';

import { ErrorState } from '../../../src/components/ErrorState';
import { HomeSkeleton } from '../../../src/components/LoadingSkeleton';
import { StickyCartBar, useCartSummary } from '../../../src/components/commerce/StickyCartBar';
import { ProductQuickView } from '../../../src/components/commerce/ProductQuickView';
import {
  VariantPickerSheet,
  type VariantPickerState,
} from '../../../src/components/commerce/VariantPickerSheet';
import { DiscoveryGrid } from '../../../src/components/home/DiscoveryGrid';
import { CategoryIconStrip } from '../../../src/components/home/CategoryIconStrip';
import { ProductDuoRail } from '../../../src/components/home/ProductDuoRail';
import { HomeHeader } from '../../../src/components/home/HomeHeader';
import { ProductSection } from '../../../src/components/home/ProductSection';
import { SakyaPromoBanner } from '../../../src/components/home/SakyaPromoBanner';
import { SectionHeader } from '../../../src/components/home/SectionHeader';
import { HERO_SLIDES, PROMO_BANNERS } from '../../../src/config/home-content';
import { useHomeCatalog } from '../../../src/hooks/use-home-catalog';
import { useHomeDiscovery, type DiscoveryTile } from '../../../src/hooks/use-home-discovery';
import { useFreshToday } from '../../../src/hooks/use-fresh-today';
import { navBarVisibility, navVisibleFromScroll } from '../../../src/lib/nav-visibility';
import { headerCollapse, headerCollapsedFromScroll } from '../../../src/lib/header-collapse';

// Import extracted components
import HomeFooter from './components/HomeFooter';
import BrandPhilosophy from './components/BrandPhilosophy';
import WelcomeBanner from './components/WelcomeBanner';

const BOTTOM_NAV_CLEARANCE = 120;

type HomeRailRow = {
  railId: string;
  title: string;
  handle: string;
  products: import('@sakya/types').ProductListItem[];
  seeAll: boolean;
};

type Row =
  | { key: string; type: 'header' }
  | { key: string; type: 'strip' }
  | { key: string; type: 'fresh-today' }
  | { key: string; type: 'welcome' }
  | { key: string; type: 'rail'; rail: HomeRailRow }
  | { key: string; type: 'collection'; sectionId: string }
  | { key: string; type: 'editorial'; railId: string }
  | { key: string; type: 'promo'; bannerId: string }
  | { key: string; type: 'philosophy' }
  | { key: string; type: 'footer' }
  | { key: string; type: 'skeleton' };

/**
 * Home — the design reference for the rest of the app.
 *
 * A single FlatList of section rows in the required order:
 *   header → search → shop by category → welcome banner → best sellers →
 *   all time favourites → combos → promo banner → vegetables → fruits →
 *   veg pickles → non-veg pickles → oils → podulu → ghee/honey → wellness →
 *   brand philosophy.
 *
 * Data: one products request + one categories request shared by the rails and
 * every discovery grid (no per-section fetches, no request storms). Rails come
 * from useHomeCatalog, discovery grids from useHomeDiscovery — both read the
 * same React Query cache. Every tile and rail navigates to its real category
 * listing; nothing on the screen is hardcoded catalog data.
 */
export default function ShopHome() {
  const insets = useSafeAreaInsets();
  const { itemCount } = useCartSummary();
  const home = useHomeCatalog();
  const discovery = useHomeDiscovery();
  const [quickViewSlug, setQuickViewSlug] = useState<string | null>(null);
  const [variantPick, setVariantPick] = useState<VariantPickerState | null>(null);
  const showQuickView = useCallback((product: import('@sakya/types').ProductListItem) => {
    setQuickViewSlug(product.slug);
  }, []);
  const showVariantPicker = useCallback((product: import('@sakya/types').ProductListItem) => {
    setVariantPick({ product });
  }, []);

  const openProduct = useCallback((slug: string) => router.push(`/(shop)/products/${slug}`), []);
  const openCategory = useCallback((slug: string) => router.push(`/(shop)/categories/${slug}`), []);

  // The quick-view pager: every product visible on this surface, in display
  // order. Swiping left/right in the sheet steps through exactly these.
  const surfaceProducts = useMemo(() => {
    const list: import('@sakya/types').ProductListItem[] = [];
    const seen = new Set<string>();
    for (const section of home.sections) {
      for (const rail of section.rails) {
        for (const product of rail.products) {
          if (!seen.has(product.slug)) {
            seen.add(product.slug);
            list.push(product);
          }
        }
      }
    }
    return list;
  }, [home.sections]);

  // Cross-sell context for the quick-view sheet: surface products minus the
  // one being viewed.
  const relatedProducts = useMemo(
    () => surfaceProducts.filter((item) => item.slug !== quickViewSlug).slice(0, 10),
    [surfaceProducts, quickViewSlug],
  );

  const isError = home.isError || discovery.isError;

  if (isError) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <ErrorState
          title="Could not load the farm"
          message="We could not reach the farm right now. Check your connection and try again."
          onRetry={() => {
            home.refetch();
            discovery.refetch();
          }}
        />
      </View>
    );
  }

  // The green header band runs full-bleed under the status bar, so the
  // top inset is consumed by the header itself, not by the screen container.
  // Light status-bar content stays readable on the dark green band.
  return (
    <View className="flex-1 bg-canvas">
      <StatusBar style="light" />
      <HomeList
        home={home}
        discovery={discovery}
        isLoading={home.isLoading || discovery.isLoading}
        onQuickView={showQuickView}
        onPickVariant={showVariantPicker}
      />
      <StickyCartBar itemCount={itemCount} onPress={() => router.push('/(shop)/cart')} />
      <ProductQuickView
        slug={quickViewSlug}
        onClose={() => setQuickViewSlug(null)}
        pagerProducts={surfaceProducts}
        relatedProducts={relatedProducts}
        onOpenProduct={(nextSlug) => {
          // Close the sheet BEFORE pushing, or the modal stays layered over
          // the product page.
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

interface HomeListProps {
  home: ReturnType<typeof useHomeCatalog>;
  discovery: ReturnType<typeof useHomeDiscovery>;
  isLoading: boolean;
  /** Present = card taps open the quick-view sheet instead of navigating. */
  onQuickView: (product: import('@sakya/types').ProductListItem) => void;
  /** Present = multi-variant ADD opens the variant picker. */
  onPickVariant: (product: import('@sakya/types').ProductListItem) => void;
}

function HomeListInner({ home, discovery, isLoading, onQuickView, onPickVariant }: HomeListProps) {
  const [refreshing, setRefreshing] = useState(false);
  const { itemCount } = useCartSummary();
  const freshToday = useFreshToday();
  const { contentWidth, screenPadding } = useResponsive();

  // The glass header is an overlay, so the list reserves its EXACT measured
  // height as top headroom — no guessed clearance, no dead gap between the
  // band and the hero banner.
  const [headerHeight, setHeaderHeight] = useState(0);

  // While home is unfocused, other tabs scroll too — their onScroll must not
  // publish into the shared buses and leave stale "hidden/collapsed" state
  // that home then inherits on return (the scroll-stuck symptom).
  useFocusEffect(
    useCallback(() => {
      return () => {
        navBarVisibility.set(true);
        headerCollapse.set(false);
      };
    }, []),
  );

  // Scroll → floating-navbar visibility (down hides, up/near-top shows) and
  // → header collapse (threshold-based: the band stays fully open until the
  // user scrolls past the hero banner, then collapses and STAYS collapsed
  // until they scroll back up past the banner — no open/close toggling).
  const lastOffset = useRef(0);
  const onScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = event.nativeEvent.contentOffset.y;
    navBarVisibility.set(navVisibleFromScroll(y, lastOffset.current, navBarVisibility.get()));
    headerCollapse.set(
      headerCollapsedFromScroll(
        y,
        lastOffset.current,
        headerCollapse.get(),
        collapseThreshold.current,
      ),
    );
    lastOffset.current = y;
  }, []);

  // Collapse threshold = measured header height + one hero-banner height,
  // so the full band is guaranteed to stay open while the banner is on
  // screen, regardless of device size. Header height arrives via callback.
  const collapseThreshold = useRef(300);

  const openProduct = useCallback((slug: string) => router.push(`/(shop)/products/${slug}`), []);
  const openCategory = useCallback((slug: string) => router.push(`/(shop)/categories/${slug}`), []);
  const openCategories = useCallback(() => router.push('/(shop)/categories'), []);
  const openSearch = useCallback(() => router.push('/search'), []);

  const openTile = useCallback((tile: DiscoveryTile) => openCategory(tile.handle), [openCategory]);
  const onPressCategory = useCallback(
    (category: import('@sakya/types').CategorySummary) => openCategory(category.slug),
    [openCategory],
  );
  const onPressProduct = useCallback(
    (product: import('@sakya/types').ProductListItem) => openProduct(product.slug),
    [openProduct],
  );

  const heroSlides = useMemo(
    () =>
      HERO_SLIDES.map((def) => ({
        key: def.key,
        image: def.image,
        accessibilityLabel: def.accessibilityLabel,
        onPress: () => openCategory(def.handle),
      })),
    [openCategory],
  );

  const railRows = useMemo(() => {
    const list: HomeRailRow[] = [];
    for (const section of home.sections) {
      if (section.kind === 'health-goals') continue;
      for (const rail of section.rails) {
        list.push({
          railId: rail.railId,
          title: rail.title,
          handle: rail.handle,
          products: rail.products,
          seeAll: rail.seeAll,
        });
      }
    }
    return list;
  }, [home.sections]);

  const seeAllByRailId = useMemo(
    () => new Map(railRows.map((rail) => [rail.railId, () => openCategory(rail.handle)])),
    [railRows, openCategory],
  );

  const discoveryById = useMemo(() => {
    const map = new Map<string, DiscoveryTile[]>();
    for (const section of discovery.sections) {
      map.set(section.def.id, section.tiles);
    }
    return map;
  }, [discovery.sections]);

  // The Farm Pantry: one consolidated browse grid from the pantry collection
  // groups (oils, ghee, honey, pickles, podulu) — deduped by handle, so a
  // collection appearing in several groups shows once.
  const pantryTiles = useMemo(() => {
    const seen = new Set<string>();
    const list: DiscoveryTile[] = [];
    for (const sectionId of ['oils', 'ghee-honey', 'veg-pickles', 'podulu'] as const) {
      for (const tile of discoveryById.get(sectionId) ?? []) {
        if (seen.has(tile.handle)) continue;
        seen.add(tile.handle);
        list.push(tile);
      }
    }
    return list;
  }, [discoveryById]);

  // Editorial duo rails: real PRODUCTS composed from collection groups —
  // same cached query, zero new API calls. Each rail carries an honest
  // subtitle and an optional banner anchored after it.
  const editorialRails = useMemo(() => {
    return EDITORIAL_RAILS.map((def) => {
      const seen = new Set<string>();
      const products: import('@sakya/types').ProductListItem[] = [];
      for (const handle of def.handles) {
        for (const product of discovery.productsByHandle.get(handle) ?? []) {
          if (seen.has(product.id)) continue;
          seen.add(product.id);
          products.push(product);
        }
      }
      return { ...def, products, hideSeeAll: def.id === 'premium-produce' };
    }).filter((rail) => rail.products.length > 0);
  }, [discovery.productsByHandle]);

  const rows = useMemo(() => {
    const list: Row[] = [];

    if (isLoading) {
      // Single skeleton row; the list keeps its structure while data loads.
      return [{ key: 'skeleton', type: 'skeleton' } as const];
    }

    // The header + category strip live INSIDE the fixed glass band (passed
    // as HomeHeader children in HomeList's JSX below) — per the sketch, the
    // strip is fixed and borderless, never a scrollable row.
    // The promo carousel IS the hero: it sits directly under the green band
    // (Blinkit/Zepto order).
    list.push({ key: 'welcome', type: 'welcome' });
    // "Fresh today" — the daily-rotating variable-reward rail.
    if (freshToday.products.length > 0) list.push({ key: 'fresh-today', type: 'fresh-today' });

    // ── After "Fresh today": an editorial flow, not a march of grids. ────
    // Best Sellers: the redesigned collection cards (hero + stack imagery).
    if ((discoveryById.get('best-sellers')?.length ?? 0) > 0) {
      list.push({ key: 'collection-best-sellers', type: 'collection', sectionId: 'best-sellers' });
    }

    // Editorial duo rails — Sakya Fresh, Andhra Heritage, Ghee & Honey —
    // real products, two cards per screen width, banners anchored after
    // the rail they advertise (each banner renders exactly once).
    for (const rail of editorialRails) {
      list.push({ key: `editorial-${rail.id}`, type: 'editorial', railId: rail.id });
      if (rail.bannerAfter != null) {
        list.push({ key: `promo-${rail.bannerAfter}`, type: 'promo', bannerId: rail.bannerAfter });
      }
    }

    // Consolidated browse grids: The Farm Pantry and Health & Wellness —
    // the only two remaining CATEGORY grids, so browsing never disappears.
    if (pantryTiles.length > 0) {
      list.push({ key: 'collection-pantry', type: 'collection', sectionId: 'pantry' });
    }
    if ((discoveryById.get('wellness')?.length ?? 0) > 0) {
      list.push({ key: 'collection-wellness', type: 'collection', sectionId: 'wellness' });
    }

    // Brand philosophy, then the deep-dive product rails closing the scroll.
    list.push({ key: 'philosophy', type: 'philosophy' });
    for (const rail of railRows) {
      list.push({ key: `rail-${rail.railId}`, type: 'rail', rail });
    }

    // Site footer closes the scroll — brand sign-off, honest links, trade
    // details. No fake contact data: everything routes to real screens.
    list.push({ key: 'footer', type: 'footer' });

    return list;
  }, [isLoading, freshToday.products.length, discoveryById, pantryTiles, editorialRails, railRows]);

  const listRows = useMemo(() => rows.filter((row): row is Row => row.type !== 'skeleton'), [rows]);

  const onHeaderHeightChange = useCallback(
    (height: number) => {
      setHeaderHeight(height);
      collapseThreshold.current =
        height + Math.round(((contentWidth - screenPadding * 2 - PEEK) * BANNER_H) / BANNER_W) + 44;
    },
    [contentWidth, screenPadding],
  );
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([home.refetch(), discovery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [home, discovery]);
  const contentContainerStyle = useMemo(
    () => ({ paddingTop: headerHeight, paddingBottom: BOTTOM_NAV_CLEARANCE }),
    [headerHeight],
  );
  const emptyListComponent = useMemo(
    () => (
      <View className="items-center gap-2 px-4 py-16">
        <RNText className="text-[16px] font-semibold text-ink">The shelves are empty</RNText>
        <RNText className="text-center text-[13.5px] leading-5 text-ink-soft">
          Our farmers are preparing the next harvest. Please check back soon.
        </RNText>
      </View>
    ),
    [],
  );
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing && isLoading}
        onRefresh={onRefresh}
        tintColor="#0B594C"
        colors={['#0B594C']}
      />
    ),
    [refreshing, isLoading, onRefresh],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => {
      switch (item.type) {
        case 'welcome':
          return (
            <View className="mt-4">
              <WelcomeBanner slides={heroSlides} />
            </View>
          );
        case 'fresh-today':
          return (
            <View className="mt-7">
              <ProductSection
                title="Fresh today"
                subtitle="Picked from today's harvest"
                products={freshToday.products}
                onPressProduct={onPressProduct}
                onQuickView={onQuickView}
                onPickVariant={onPickVariant}
              />
            </View>
          );
        case 'collection': {
          const tiles =
            item.sectionId === 'pantry' ? pantryTiles : (discoveryById.get(item.sectionId) ?? []);
          if (tiles.length === 0) return null;
          const title =
            item.sectionId === 'pantry'
              ? 'The Farm Pantry'
              : (COLLECTION_TITLES[item.sectionId] ?? item.sectionId);
          return (
            <View className="mt-10 gap-3">
              <SectionHeader title={title} />
              <DiscoveryGrid tiles={tiles} onPressTile={openTile} />
            </View>
          );
        }
        case 'editorial': {
          const rail = editorialRails.find((candidate) => candidate.id === item.railId);
          if (!rail) return null;
          return (
            <View className="mt-7">
              <ProductDuoRail
                title={rail.title}
                subtitle={rail.subtitle}
                products={rail.products}
                onPressProduct={onPressProduct}
                onQuickView={onQuickView}
                onPickVariant={onPickVariant}
                hideSeeAll={rail.hideSeeAll}
              />
            </View>
          );
        }
        case 'promo': {
          const banner = PROMO_BANNERS.find((candidate) => candidate.key === item.bannerId);
          if (!banner) return null;
          return (
            <View className="mt-7">
              <SakyaPromoBanner banner={banner} onPress={openCategory} />
            </View>
          );
        }
        case 'rail':
          return (
            <View className="mt-7">
              <ProductSection
                title={item.rail.title}
                products={item.rail.products}
                onPressProduct={onPressProduct}
                onSeeAll={item.rail.seeAll ? seeAllByRailId.get(item.rail.railId) : undefined}
                onQuickView={onQuickView}
                onPickVariant={onPickVariant}
              />
            </View>
          );
        case 'philosophy':
          return <BrandPhilosophy />;
        case 'footer':
          return <HomeFooter />;
        default:
          return null;
        }
      },
      [
        heroSlides,
        freshToday.products,
        onPressProduct,
        onQuickView,
        onPickVariant,
        pantryTiles,
        discoveryById,
        openTile,
        editorialRails,
        openCategory,
        seeAllByRailId,
      ],
    );

  if (rows[0]?.type === 'skeleton') {
    return <HomeSkeleton />;
  }

  return (
    <View className="flex-1">
      {/* Glass OVERLAY header — the list runs edge-to-edge BENEATH it, so the
          blur actually frosts real scrolling pixels (bottom-navbar effect).
          The category strip renders INSIDE the band via children; the list
          content's top spacer keeps the first row clear when fully expanded. */}
      <HomeHeader
        onSearchPress={openSearch}
        cartCount={itemCount}
        onHeightChange={onHeaderHeightChange}
      >
        {home.stripCategories.length > 0 ? (
          <CategoryIconStrip
            categories={home.stripCategories}
            onPress={onPressCategory}
            onPressAll={openCategories}
            rows={1}
            onGlass
          />
        ) : null}
      </HomeHeader>
      <FlatList
        data={listRows}
        keyExtractor={keyExtractor}
        showsVerticalScrollIndicator={false}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={7}
        removeClippedSubviews={false}
        refreshControl={refreshControl}
        contentContainerStyle={contentContainerStyle}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListEmptyComponent={emptyListComponent}
        renderItem={renderItem}
      />
    </View>
  );
}

const HomeList = memo(HomeListInner);

const keyExtractor = (row: Row): string => row.key;

/**
 * Editorial composition for everything after "Fresh today".
 *
 * The old flow marched through ELEVEN near-identical category grids with the
 * same collections repeating across them (oils/pickles/ghee appeared in Best
 * Sellers, Favourites AND Combos). The recomposed flow alternates rhythm:
 * collection grid → product duo rail → banner → duo rail → grid → rails.
 *
 * Editorial rails compose REAL products from collection groups (union,
 * deduped by id) — no invented data, no new API calls (same cached query the
 * grids use).
 */
const EDITORIAL_RAILS: Array<{
  id: string;
  title: string;
  subtitle: string;
  handles: string[];
  /** Banner key anchored directly after this rail (rendered once). */
  bannerAfter?: string;
  /** Rails with no single category destination omit the See All label. */
  hideSeeAll?: boolean;
}> = [
  {
    id: 'sakya-fresh',
    title: 'Sakya Fresh',
    subtitle: 'Harvested this season, from our fields',
    handles: ['vegetables', 'fruits', 'country-special-copy'],
    bannerAfter: 'sakya-fresh',
  },
  {
    // The catalog's own premium/exotic shelf: "Premium Vegetables"
    // (gourds-local-vegetables-copy: broccoli, capsicum, baby corn…) plus
    // the fresh-fruit pairs. Products from these handles wear the
    // data-driven Premium / Fresh badges on their cards.
    id: 'premium-produce',
    title: 'Premium Produce',
    subtitle: 'Exotic vegetables & finest fruits, picked at prime',
    handles: [
      'gourds-local-vegetables-copy',
      'premium-vegetables-copy',
      'country-special-copy',
      'leafy-greens-copy',
    ],
    // No banner of its own — it sits right after the Sakya Fresh banner.
  },
  {
    id: 'andhra',
    title: 'Andhra Heritage',
    subtitle: 'Podulu, pickles & spice powders, ground the old way',
    handles: ['podulu', 'andhra-podulu', 'spice-powders', 'veg-pickles', 'nonveg-pickles'],
    bannerAfter: 'andhra',
  },
  {
    id: 'ghee-honey',
    title: 'Ghee & Honey',
    subtitle: 'Churned and harvested on the farm',
    handles: ['best-ghee', 'ghee', 'honey'],
    bannerAfter: 'ghee-honey',
  },
];

/** Titles for the two remaining category browse grids. */
const COLLECTION_TITLES: Record<string, string> = {
  'best-sellers': 'Best Sellers',
  wellness: 'Health & Wellness',
};

/**
 * Home footer — the closing statement. Brand sign-off, real navigation links
 * (every route exists), and the delivery promise pulled from the SAME data
 * the checkout uses (support settings), never invented claims. A quiet
 * trademark line ends the scroll.
 */

/* This function has been moved to ./components/HomeFooter.tsx */

/**
 * Brand philosophy: quiet, premium, factual. No testimonials, no review-style
 * marketing, no claims the backend cannot back — just the farm-to-home idea.
 */

/* This function has been moved to ./components/BrandPhilosophy.tsx */

/**
 * Welcome hero: the 6-slide promo carousel directly under the green band —
 * the quick-commerce hero (Blinkit/Zepto). Auto-advances with pause-on-touch;
 * every supplied creative renders with pill/expand dot pagination; each
 * slide taps through to its category.
 */

/* This function has been moved to ./components/WelcomeBanner.tsx */