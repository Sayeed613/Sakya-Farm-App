import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  RefreshControl,
  Text as RNText,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState } from '../../src/components/ErrorState';
import { HomeSkeleton } from '../../src/components/LoadingSkeleton';
import { StickyCartBar, useCartSummary } from '../../src/components/commerce/StickyCartBar';
import { ProductQuickView } from '../../src/components/commerce/ProductQuickView';
import { VariantPickerSheet, type VariantPickerState } from '../../src/components/commerce/VariantPickerSheet';
import { CategoryIconStrip } from '../../src/components/home/CategoryIconStrip';
import { HealthGoalCard } from '../../src/components/home/HealthGoalCard';
import { HeroCarousel } from '../../src/components/home/HeroCarousel';
import { HomeHeader } from '../../src/components/home/HomeHeader';
import { ProductSection } from '../../src/components/home/ProductSection';
import { SearchBar } from '../../src/components/home/SearchBar';
import { SectionHeader } from '../../src/components/home/SectionHeader';
import { BRAND_STORY, HERO_SLIDES, TESTIMONIALS, TRUST_LINE, type Testimonial } from '../../src/config/home-content';
import { HEALTH_GOALS } from '../../src/config/home-sections';
import { useHomeCatalog } from '../../src/hooks/use-home-catalog';

const BOTTOM_NAV_CLEARANCE = 120;
const GOAL_TINTS = ['#E4EFE7', '#F7E9DD', '#F3EDE3', '#E4EFE7'];
const SLIDE_W = Dimensions.get('window').width - 32;
type HomeRailRow = {
  railId: string;
  title: string;
  handle: string;
  products: import('@sakya/types').ProductListItem[];
  seeAll: boolean;
};
const HERO_SLIDE_DEFS = HERO_SLIDES;

type Row =
  | { key: string; type: 'header' }
  | { key: string; type: 'search' }
  | { key: string; type: 'hero' }
  | { key: string; type: 'strip' }
  | { key: string; type: 'rail'; rail: HomeRailRow }
  | { key: string; type: 'goals' }
  | { key: string; type: 'story' }
  | { key: string; type: 'testimonials' }
  | { key: string; type: 'skeleton' };

/**
 * Home — the design reference for the rest of the app.
 *
 * A single FlatList of section rows over the central useHomeCatalog hook: two
 * API calls total for the whole screen, no mock products, per-rail loading
 * skeletons and empty states. Every product section is driven by the real
 * catalog grouped into the rails declared in `home-sections.ts`.
 */
export default function ShopHome() {
  const insets = useSafeAreaInsets();
  const { itemCount } = useCartSummary();
  const home = useHomeCatalog();
  const [quickViewSlug, setQuickViewSlug] = useState<string | null>(null);
  const [variantPick, setVariantPick] = useState<VariantPickerState | null>(null);

  const openProduct = useCallback((slug: string) => router.push(`/(shop)/products/${slug}`), []);

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

  if (home.isError) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <ErrorState
          title="Could not load the farm"
          message="We could not reach the farm right now. Check your connection and try again."
          onRetry={home.refetch}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <HomeList
        home={home}
        onQuickView={(product) => setQuickViewSlug(product.slug)}
        onPickVariant={(product) => setVariantPick({ product })}
      />
      <StickyCartBar
        itemCount={itemCount}
        onPress={() => router.push('/(shop)/cart')}
      />
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
      />
      <VariantPickerSheet pick={variantPick} onClose={() => setVariantPick(null)} />
    </View>
  );
}

interface HomeListProps {
  home: ReturnType<typeof useHomeCatalog>;
  /** Present = card taps open the quick-view sheet instead of navigating. */
  onQuickView: (product: import('@sakya/types').ProductListItem) => void;
  /** Present = multi-variant ADD opens the variant picker. */
  onPickVariant: (product: import('@sakya/types').ProductListItem) => void;
}

function HomeList({ home, onQuickView, onPickVariant }: HomeListProps) {
  const [refreshing, setRefreshing] = useState(false);

  const openProduct = useCallback((slug: string) => router.push(`/(shop)/products/${slug}`), []);
  const openCategory = useCallback((slug: string) => router.push(`/(shop)/categories/${slug}`), []);
  const openCategories = useCallback(() => router.push('/(shop)/categories'), []);
  const openSearch = useCallback(() => router.push('/search'), []);

  // Hero slides are the supplied banner creatives, each tapping through to
  // its category. No catalog imagery is involved — the artwork IS the slide.
  const heroSlides = useMemo(
    () =>
      HERO_SLIDE_DEFS.map((def) => ({
        key: def.key,
        image: def.image,
        accessibilityLabel: def.accessibilityLabel,
        onPress: () => openCategory(def.handle),
      })),
    [openCategory],
  );

  const rows = useMemo(() => {
    const list: Row[] = [];

    if (home.isLoading) {
      // Single skeleton row; the list keeps its structure while data loads.
      return [{ key: 'skeleton', type: 'skeleton' } as const];
    }

    list.push({ key: 'header', type: 'header' });
    list.push({ key: 'search', type: 'search' });
    if (heroSlides.length > 0) list.push({ key: 'hero', type: 'hero' });
    if (home.stripCategories.length > 0) list.push({ key: 'strip', type: 'strip' });

    for (const section of home.sections) {
      if (section.kind === 'health-goals') {
        list.push({ key: `goals-${section.section.id}`, type: 'goals' });
        continue;
      }
      for (const rail of section.rails) {
        list.push({ key: `rail-${rail.railId}`, type: 'rail', rail });
      }
    }

    list.push({ key: 'story', type: 'story' });
    list.push({ key: 'testimonials', type: 'testimonials' });
    return list;
  }, [home, heroSlides]);

  if (rows[0]?.type === 'skeleton') {
    return <HomeSkeleton />;
  }

  const listRows: Row[] = rows.filter(
    (row): row is Row => (row as Row).type !== 'skeleton',
  );

  return (
    <FlatList
      data={listRows}
      keyExtractor={(row) => row.key}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing && home.isLoading}
          onRefresh={() => {
            setRefreshing(true);
            home.refetch();
            setRefreshing(false);
          }}
          tintColor="#0B594C"
          colors={['#0B594C']}
        />
      }
      contentContainerStyle={{ paddingBottom: BOTTOM_NAV_CLEARANCE }}
      ListEmptyComponent={
        <View className="items-center gap-2 px-4 py-16">
          <RNText className="text-[16px] font-semibold text-ink">The shelves are empty</RNText>
          <RNText className="text-center text-[13.5px] leading-5 text-ink-soft">
            Our farmers are preparing the next harvest. Please check back soon.
          </RNText>
        </View>
      }
      renderItem={({ item }) => {
        switch (item.type) {
          case 'header':
            return <HomeHeader trustLine={TRUST_LINE} />;
          case 'search':
            return (
              <View className="mt-2">
                <SearchBar onPress={openSearch} />
              </View>
            );
          case 'hero':
            return (
              <View className="mt-4">
                <HeroCarousel slides={heroSlides} />
              </View>
            );
          case 'strip':
            return (
              <View className="mt-6">
                <SectionHeader title="Shop by category" onSeeAll={openCategories} />
                <View className="mt-3">
                  <CategoryIconStrip
                    categories={home.stripCategories}
                    onPress={(category) => openCategory(category.slug)}
                  />
                </View>
              </View>
            );
          case 'rail':
            return (
              <View className="mt-6">
                <ProductSection
                  title={item.rail.title}
                  products={item.rail.products}
                  onPressProduct={(product) => openProduct(product.slug)}
                  onSeeAll={
                    item.rail.seeAll ? () => openCategory(item.rail.handle) : undefined
                  }
                  onQuickView={onQuickView}
                  onPickVariant={onPickVariant}
                />
              </View>
            );
          case 'goals':
            return (
              <View className="mt-7 gap-3">
                <SectionHeader title="Shop by health goal" subtitle="Curated guides, not just products" />
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={HEALTH_GOALS}
                  keyExtractor={(goal) => goal.handle}
                  contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                  renderItem={({ item: goal, index }) => (
                    <HealthGoalCard
                      title={goal.title}
                      description={goal.description}
                      icon={goal.icon}
                      tint={GOAL_TINTS[index % GOAL_TINTS.length] ?? '#E4EFE7'}
                      onPress={() => openCategory(goal.handle)}
                    />
                  )}
                />
              </View>
            );
          case 'story':
            return <BrandStory />;
          case 'testimonials':
            return <TestimonialCarousel testimonials={TESTIMONIALS} />;
          default:
            return null;
        }
      }}
    />
  );
}

/** Brand story block: static editorial content, full width. */
function BrandStory() {
  return (
    <View className="mt-8 px-4">
      <View className="gap-2 rounded-2xl border border-line bg-hero px-5 py-6">
        <RNText className="text-[10px] font-bold uppercase tracking-widest text-white/60">
          {BRAND_STORY.eyebrow}
        </RNText>
        <RNText className="text-[19px] font-bold leading-6" style={{ color: '#F5F2E8' }}>
          {BRAND_STORY.heading}
        </RNText>
        <RNText className="mt-1 text-[13px] leading-5 text-white/75">
          {BRAND_STORY.body}
        </RNText>
      </View>
    </View>
  );
}

function TestimonialCarousel({ testimonials }: { testimonials: Testimonial[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewabilityRef = useRef({ viewAreaCoveragePercentThreshold: 60 });

  return (
    <View className="mt-7 gap-2">
      <SectionHeader title="From our customers" />
      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={testimonials}
        keyExtractor={(testimonial) => testimonial.key}
        viewabilityConfig={viewabilityRef.current}
        onViewableItemsChanged={useCallback(
          ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            const first = viewableItems[0]?.index;
            if (first != null) setActiveIndex(first);
          },
          [],
        )}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        renderItem={({ item }) => (
          <View
            className="rounded-2xl border border-line bg-white p-4"
            style={{ width: SLIDE_W }}
          >
            <RNText className="text-[13.5px] leading-5 text-ink">“{item.quote}”</RNText>
            <RNText className="mt-2.5 text-[12px] font-bold text-ink">{item.author}</RNText>
            <RNText className="text-[11px] text-ink-soft">{item.location}</RNText>
          </View>
        )}
      />
      {testimonials.length > 1 ? (
        <View className="flex-row items-center justify-center gap-1.5">
          {testimonials.map((testimonial, index) => (
            <View
              key={testimonial.key}
              className="h-1.5 rounded-full"
              style={{
                width: index === activeIndex ? 16 : 6,
                backgroundColor: index === activeIndex ? '#0B594C' : '#D2C4AE',
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
