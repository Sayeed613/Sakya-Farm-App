import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import {
  Dimensions,
  FlatList,
  Pressable,
  Share,
  Text as RNText,
  View,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { catalogApi } from '../../../src/api/catalog';
import { ErrorState } from '../../../src/components/ErrorState';
import { SkeletonBlock } from '../../../src/components/LoadingSkeleton';
import { ProductDetailsSheet } from '../../../src/components/commerce/ProductDetailsSheet';
import { ProductVariantSelector } from '../../../src/components/commerce/ProductVariantSelector';
import { RelatedProductCard } from '../../../src/components/commerce/RelatedProductCard';
import { QuantityStepper } from '../../../src/components/commerce/QuantityStepper';
import { formatMoney } from '../../../src/lib/format';
import { describeProduct } from '../../../src/lib/product-description';
import { deriveBadges } from '../../../src/lib/product-badges';
import { defaultVariantOfDetail, useProductAdd } from '../../../src/lib/use-product-add';
import { variantSelectorLabelOf } from '../../../src/lib/variant-units';
import { useGuestCartStore } from '../../../src/stores/guest-cart-store';
import type { ProductDetail, ProductListItem } from '@sakya/types';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const CANVAS = '#FAF7F0';
const SLIDE_H = 340;
const W = Dimensions.get('window').width;

// TRUE MORPH: the hero gallery is rendered ONCE, absolutely positioned above
// the ScrollView, and as the page scrolls it flies from full-bleed into a
// 34x34 rounded chip in the header slot — top/left/size/borderRadius driven
// by scrollY and clamped over this range (px).
const MORPH_RANGE: [number, number] = [0, 260];
// While the chip flies, the scroll must still feel like ONE page: content
// keeps scrolling normally beneath the floating hero (the spacer holds the
// hero's place in the flow).
const MORPH_CHIP = 34;
const MORPH_CHIP_RADIUS = 9;
// Header slot geometry: back button + gap → chip lands at left ~64,
// vertically centred in the header row → top = insets.top + ~19.
const HEADER_SLOT_LEFT = 64;
// Chip geometry: 56px header row + 12px horizontal padding (px-3).
const HEADER_ROW_HEIGHT = 56;
// Header slot top = insets.top + ~19 (chip sits inside the header bar).
const HEADER_SLOT_TOP_OFFSET = 19;

/**
 * Premium product detail (references 2 + 4).
 *
 * Hero gallery with dots, unit-aware variant selection (the backend's variant
 * titles are rendered verbatim and drive the selector heading), premium
 * treatment ONLY from real tags, related products from cached catalog data,
 * and a sticky bar that adds the EXACT selected variant. The View Details
 * sheet layers over this page without losing the selection.
 *
 * Gesture: a TRUE MORPH — the hero gallery is rendered once, absolutely
 * positioned above the ScrollView (never part of the scrolling content),
 * and as the page scrolls that ONE element flies from full-bleed into a
 * 34×34 rounded chip inside the header. An invisible spacer of the hero's
 * height keeps the content flowing beneath it, and the header title fades
 * in beside the landed chip.
 */
export default function ProductDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const viewabilityRef = useRef({ viewAreaCoveragePercentThreshold: 60 });

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // THE MORPH — one element, five animated properties, clamped. It starts
  // exactly on top of the (removed) in-flow hero position and lands in the
  // header slot next to the back button.
  const morphStyle = useAnimatedStyle(
    () => ({
      top: interpolate(scrollY.value, MORPH_RANGE, [0, insets.top + HEADER_SLOT_TOP_OFFSET], Extrapolation.CLAMP),
      left: interpolate(scrollY.value, MORPH_RANGE, [0, HEADER_SLOT_LEFT], Extrapolation.CLAMP),
      width: interpolate(scrollY.value, MORPH_RANGE, [W, MORPH_CHIP], Extrapolation.CLAMP),
      height: interpolate(scrollY.value, MORPH_RANGE, [SLIDE_H, MORPH_CHIP], Extrapolation.CLAMP),
      borderRadius: interpolate(scrollY.value, MORPH_RANGE, [0, MORPH_CHIP_RADIUS], Extrapolation.CLAMP),
    }),
    [insets.top],
  );

  // Header chrome: the white bar fades in under the flying chip, the title
  // fades in beside it, and the gallery dots fade out early in the morph.
  const headerBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, MORPH_RANGE, [0, 1], Extrapolation.CLAMP),
  }));

  const headerTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, MORPH_RANGE, [0, 1], Extrapolation.CLAMP),
  }));

  const heroDotsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 60], [1, 0], Extrapolation.CLAMP),
  }));

  const detail = useQuery({
    queryKey: ['catalog', 'product', slug],
    queryFn: () => catalogApi.getProduct(slug),
    enabled: Boolean(slug),
    staleTime: 120_000,
  });

  const detailData: ProductDetail | null = detail.data ?? null;
  const variants = detailData?.variants ?? [];
  const selected =
    variants.find((variant) => variant.id === selectedVariantId) ??
    (detailData ? defaultVariantOfDetail(detailData) : null);

  // Stepper bridge: shows the quantity of whichever variant of this product is
  // already in the cart, so a picker-chosen pack keeps its count visible.
  const bridgeProduct = useMemo<ProductListItem | null>(() => {
    if (!detailData) return null;
    return {
      id: detailData.id,
      slug: detailData.slug,
      title: detailData.title,
      vendor: detailData.vendor,
      productType: detailData.productType,
      isAvailable: detailData.isAvailable,
      primaryImageUrl: detailData.primaryImageUrl,
      imageUrls: detailData.imageUrls,
      price: detailData.price,
      compareAtMaxInPaise: detailData.compareAtMaxInPaise,
      variantCount: detailData.variantCount,
      availableVariantCount: detailData.availableVariantCount,
      variantTitles: detailData.variantTitles,
      categories: detailData.categories,
      publishedAt: detailData.publishedAt,
    };
  }, [detailData]);

  const stepper = useProductAdd(
    bridgeProduct ?? {
      id: '',
      slug: '',
      title: '',
      vendor: null,
      productType: null,
      isAvailable: false,
      primaryImageUrl: null,
      imageUrls: [],
      price: null,
      compareAtMaxInPaise: null,
      variantCount: 0,
      availableVariantCount: 0,
      variantTitles: [],
      categories: [],
      publishedAt: null,
    },
  );

  const onAddPress = useCallback(() => {
    if (!selected || !detailData) return;
    const store = useGuestCartStore.getState();
    store.rememberPrice(selected.id, selected.priceInPaise);
    store.rememberLastAdded(detailData.slug, detailData.primaryImageUrl);
    store.addLine(selected.id, 1, {
      productTitle: detailData.title,
      variantTitle: selected.title,
      imageUrl: detailData.primaryImageUrl,
      slug: detailData.slug,
    });
  }, [selected, detailData, stepper]);

  // Small local helpers so the stepper always operates on the SELECTED variant.
  const stepperIncrement = useCallback(
    (variantId: string) => {
      const store = useGuestCartStore.getState();
      const current = store.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
      store.setQuantity(variantId, current + 1);
    },
    [],
  );

  const stepperDecrement = useCallback(() => {
    if (!selected) return;
    const store = useGuestCartStore.getState();
    const current = store.lines.find((line) => line.variantId === selected.id)?.quantity ?? 0;
    store.setQuantity(selected.id, current - 1);
  }, [selected]);

  // Related products: ONLY from the already-fetched catalog cache (no request).
  const relatedProducts = useMemo<ProductListItem[]>(() => {
    const cached = queryClient.getQueryData<{ items: ProductListItem[] }>([
      'catalog',
      'products',
      'home-all',
    ]);
    return (cached?.items ?? []).filter((item) => item.slug !== slug).slice(0, 10);
  }, [queryClient, slug]);

  const selectedQuantity =
    selected != null
      ? (useGuestCartStore.getState().lines.find((line) => line.variantId === selected.id)?.quantity ?? 0)
      : 0;

  const handleShare = useCallback(() => {
    if (!detailData) return;
    void Share.share({ message: `${detailData.title} — Sakya Farms` });
  }, [detailData]);

  if (detail.isPending || !detailData) {
    if (detail.isError) {
      return (
        <View className="flex-1" style={{ backgroundColor: CANVAS, paddingTop: insets.top }}>
          <ErrorState
            title="Could not load this product"
            message="We could not reach the product just now. Check your connection and try again."
            onRetry={() => void detail.refetch()}
          />
        </View>
      );
    }
    return (
      <View className="flex-1" style={{ backgroundColor: CANVAS, paddingTop: insets.top }}>
        <View className="gap-3 px-4 pt-4">
          <SkeletonBlock className="h-72 w-full rounded-2xl" />
          <SkeletonBlock className="h-5 w-2/3" />
          <SkeletonBlock className="h-4 w-1/3" />
          <SkeletonBlock className="h-10 w-full rounded-xl" />
        </View>
      </View>
    );
  }

  const images =
    detailData.images.length > 0
      ? detailData.images
      : detailData.primaryImageUrl
        ? [{ url: detailData.primaryImageUrl, altText: null, position: 0 }]
        : [];

  const badges = deriveBadges(detailData);
  const premiumTags = new Set(['premium', 'imported', 'organic', 'speciality', 'specialty']);
  const premiumTag = detailData.tags.find((tag) => premiumTags.has(tag.toLowerCase()));
  const selectorLabel = variantSelectorLabelOf(variants);

  return (
    <View className="flex-1" style={{ backgroundColor: CANVAS }}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ── Hero spacer ────────────────────────────────────────────────
            The real gallery is the morphing element ABOVE the ScrollView;
            this invisible spacer of the same height keeps every section
            below flowing exactly as before while the hero floats over it. */}
        <View style={{ height: SLIDE_H }} />

        {/* ── Product information ──────────────────────────────────────── */}
        <View className="gap-1.5 px-4 pt-4">
          {premiumTag ? (
            <View className="mb-1 self-start rounded-full bg-brand/10 px-2.5 py-1">
              <RNText
                className="text-[10.5px] font-bold uppercase tracking-wide"
                style={{ color: BRAND }}
              >
                {premiumTag}
              </RNText>
            </View>
          ) : null}

          <RNText className="text-[21px] font-bold leading-7" style={{ color: INK }}>
            {detailData.title}
          </RNText>
          <RNText className="text-[13px]" style={{ color: MUTED }}>
            {selected?.title ?? 'Currently unavailable'}
          </RNText>
          <View className="mt-1 flex-row items-baseline gap-2">
            {selected ? (
              <>
                <RNText className="text-[22px] font-bold" style={{ color: INK }}>
                  {formatMoney(selected.priceInPaise)}
                </RNText>
                {selected.compareAtPriceInPaise != null &&
                selected.compareAtPriceInPaise > selected.priceInPaise ? (
                  <View className="flex-row items-baseline gap-1">
                    <RNText className="text-[11.5px]" style={{ color: MUTED }}>MRP</RNText>
                    <RNText className="text-[13px] line-through" style={{ color: MUTED }}>
                      {formatMoney(selected.compareAtPriceInPaise)}
                    </RNText>
                  </View>
                ) : null}
                {badges.discountPercent != null ? (
                  <View className="rounded-full bg-brand/10 px-2 py-0.5">
                    <RNText className="text-[10.5px] font-bold" style={{ color: BRAND }}>
                      {badges.discountPercent}% OFF
                    </RNText>
                  </View>
                ) : null}
              </>
            ) : (
              <RNText className="text-[14px]" style={{ color: MUTED }}>
                Currently unavailable
              </RNText>
            )}
          </View>
        </View>

        {/* ── Unit-aware variant selector ──────────────────────────────── */}
        {variants.length > 0 ? (
          <View className="mt-5 px-4">
            <ProductVariantSelector
              variants={variants}
              selected={selected}
              onSelect={(variant) => setSelectedVariantId(variant.id)}
              showPrices
              size="large"
            />
            {selectorLabel == null ? null : (
              <RNText className="mt-1 text-[11px]" style={{ color: MUTED }}>
                Prices update with the selected {selectorLabel.replace('Select ', '').toLowerCase()}
              </RNText>
            )}
          </View>
        ) : null}

        {/* ── Description ─────────────────────────────────────────────── */}
        <View className="mt-5 px-4">
          <RNText className="text-[15px] font-bold" style={{ color: INK }}>
            About this product
          </RNText>
          <RNText className="mt-1 text-[13px] leading-5" style={{ color: MUTED }}>
            {describeProduct(detailData)}
          </RNText>
        </View>

        {/* ── View details entry to the information sheet ──────────────── */}
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open all product details"
          className="mx-4 mt-4 flex-row items-center justify-between rounded-2xl border bg-white px-3.5 py-3"
          style={{ borderColor: LINE }}
        >
          <View className="flex-row items-center gap-2.5">
            <Ionicons name="information-circle-outline" size={17} color={BRAND} />
            <RNText className="text-[13px] font-semibold" style={{ color: INK }}>
              View details
            </RNText>
          </View>
          <Ionicons name="chevron-forward" size={15} color={MUTED} />
        </Pressable>

        {/* ── Related products (cache-only) ────────────────────────────── */}
        {relatedProducts.length > 0 ? (
          <View className="mt-6 gap-2.5">
            <RNText className="px-4 text-[16px] font-bold" style={{ color: INK }}>
              People also bought
            </RNText>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={relatedProducts}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <RelatedProductCard
                  item={item}
                  onOpen={(nextSlug) => router.push(`/(shop)/products/${nextSlug}`)}
                />
              )}
            />
          </View>
        ) : null}
      </Animated.ScrollView>

      {/* ── Collapsing header + morphing hero ──────────────────────────────
          Three layers, bottom → top:
          1) the white bar background, fading in as the hero scrolls under it
          2) THE MORPH: the one hero gallery — absolutely positioned, never
             part of the scroll content — flying from full-bleed into the
             34×34 rounded chip in the header slot (top/left/size/radius,
             all clamped, driven by scrollY)
          3) the header controls: back/share always reachable, the product
             title fading in beside the landed chip
          The chip is the hero itself — no second image is ever rendered. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: insets.top + HEADER_ROW_HEIGHT,
            backgroundColor: '#fff',
            borderBottomWidth: 1,
            borderBottomColor: LINE,
          },
          headerBgStyle,
        ]}
      />

      <Animated.View
        style={[{ position: 'absolute', overflow: 'hidden' }, morphStyle]}
        className="bg-surface-muted"
      >
        <FlatList
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          data={images}
          keyExtractor={(image, index) => `${image.url}-${index}`}
          viewabilityConfig={viewabilityRef.current}
          onViewableItemsChanged={useCallback(
            ({ viewableItems }: { viewableItems: ViewToken[] }) => {
              const first = viewableItems[0]?.index;
              if (first != null) setImageIndex(first);
            },
            [],
          )}
          renderItem={({ item }) => (
            <Image
              source={{ uri: item.url }}
              style={{ width: W, height: SLIDE_H }}
              contentFit="cover"
              cachePolicy="disk"
              recyclingKey={item.url}
              transition={180}
              accessibilityLabel={item.altText ?? `${detailData.title} image`}
            />
          )}
        />
        {images.length > 1 ? (
          <Animated.View
            pointerEvents="none"
            style={heroDotsStyle}
            className="absolute bottom-2.5 left-0 right-0 flex-row items-center justify-center gap-1.5"
          >
            {images.map((image, index) => (
              <View
                key={`${image.url}-${index}`}
                className="h-1.5 rounded-full"
                style={{
                  width: index === imageIndex ? 18 : 6,
                  backgroundColor: index === imageIndex ? BRAND : 'rgba(255,255,255,0.85)',
                }}
              />
            ))}
          </Animated.View>
        ) : null}
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        className="absolute left-0 right-0 top-0"
        style={{ paddingTop: insets.top }}
      >
        <View
          style={{
            height: HEADER_ROW_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
          }}
        >
          <CircleButton onPress={() => router.back()} icon="chevron-back" label="Go back" />

          {/* Landing slot (34×34) for the morphing chip + the title that
              fades in beside it — the chip itself is the morph element. */}
          <Animated.View
            pointerEvents="none"
            style={[
              { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 },
              headerTitleStyle,
            ]}
          >
            <View style={{ width: MORPH_CHIP, height: MORPH_CHIP }} />
            <RNText
              numberOfLines={1}
              className="ml-2.5 flex-1 text-[13.5px] font-bold"
              style={{ color: INK }}
            >
              {detailData.title}
            </RNText>
          </Animated.View>

          <CircleButton onPress={handleShare} icon="share-social-outline" label="Share this product" />
        </View>
      </Animated.View>

      {/* ── Sticky add-to-cart bar — the EXACT selected variant ────────── */}
      <View
        className="absolute left-0 right-0 bottom-0 flex-row items-center justify-between border-t bg-white px-4 pt-2.5"
        style={{ borderColor: LINE, paddingBottom: Math.max(insets.bottom, 12) + 2 }}
      >
        <View>
          {selected ? (
            <View className="flex-row items-baseline gap-1.5">
              <RNText className="text-[12.5px] font-semibold" style={{ color: MUTED }}>
                {selected.title}
              </RNText>
              <RNText className="text-[17px] font-bold" style={{ color: INK }}>
                {formatMoney(selected.priceInPaise)}
              </RNText>
            </View>
          ) : (
            <RNText className="text-[12px]" style={{ color: MUTED }}>
              Currently unavailable
            </RNText>
          )}
          <RNText className="text-[10px]" style={{ color: MUTED }}>
            Inclusive of all taxes
          </RNText>
        </View>
        <View className="flex-row items-center gap-2">
          {selectedQuantity > 0 ? (
            <QuantityStepper
              quantity={selectedQuantity}
              disabled={false}
              onAdd={onAddPress}
              onIncrement={() => {
                if (selected) stepperIncrement(selected.id);
              }}
              onDecrement={stepperDecrement}
            />
          ) : null}
          <Pressable
            onPress={onAddPress}
            disabled={selected == null}
            accessibilityRole="button"
            accessibilityLabel="Add to cart"
            accessibilityState={{ disabled: selected == null }}
            className={
              'rounded-full px-6 py-3 ' + (selected == null ? 'opacity-40' : 'active:opacity-85')
            }
            style={{ backgroundColor: BRAND }}
          >
            <RNText className="text-[13.5px] font-bold text-white">Add to Cart</RNText>
          </Pressable>
        </View>
      </View>

      {/* ── View details sheet — layered over this page ────────────────── */}
      <ProductDetailsSheet
        detail={sheetOpen ? detailData : null}
        selectedTitle={selected?.title ?? null}
        selectedPriceInPaise={selected?.priceInPaise ?? null}
        selectedCompareAtInPaise={selected?.compareAtPriceInPaise ?? null}
        onAdd={onAddPress}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

/** Circular floating control over the hero image. */
function CircleButton({
  onPress,
  icon,
  label,
}: {
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-9 w-9 items-center justify-center rounded-full bg-white/95"
    >
      <Ionicons name={icon} size={18} color={INK} />
    </Pressable>
  );
}