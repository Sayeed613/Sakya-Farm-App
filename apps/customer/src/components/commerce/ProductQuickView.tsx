import { BackHandler, Platform } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, MutableRefObject, ReactNode } from 'react';

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type ViewToken,
} from 'react-native';

import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { catalogApi } from '../../api/catalog';
import { FALLBACK_CATEGORY_ICON } from '../../config/category-icons';
import { getCategoryImage } from '../../config/category-images';
import type {
  CategorySummary,
  ProductDetail,
  ProductListItem,
} from '@sakya/types';

import { formatMoney } from '../../lib/format';
import { cdnImageUri } from '../../lib/cdn-image';
import { deckFeaturesFor } from './deck-features';
import { useProductAdd } from '../../lib/use-product-add';
import { useWishlist } from '../../hooks/use-wishlist';
import { useResponsive } from '../../lib/responsive';
import { useAuthStore } from '../../stores/auth-store';
import { ProductImageGallery } from './ProductImageGallery';
import { QuantityStepper } from './QuantityStepper';

/* ============================================================
   REFERENCE QUICK-VIEW GEOMETRY

   [peek][gap][ CURRENT PRODUCT ][gap][peek]

   The card is almost full height, but it is a real rounded sheet:
   the home screen remains visible above/below it and the product
   content scrolls vertically inside the card.

   The widths are derived per-render from the live viewport (see
   CategoryProductPager) — this file used to freeze them from `Dimensions`
   at module load, so on a wide browser the cards sized to the whole window.
============================================================ */
const INNER_PEEK = 22;
const INNER_GAP = 10;

const BRAND = '#0B594C';
const CARD_BG = '#FFFFFF';
const TEXT = '#171A18';
const MUTED = '#8C8A80';
const BORDER = '#E4DACA';
const CTA_GREEN = '#0B594C';

const CARD_TOP_EXTRA = 10;
const CARD_BOTTOM_EXTRA = 10;
const QUICK_VIEW_HANDLE_HEIGHT = 22;
const QUICK_VIEW_HEADER_HEIGHT = 54;
const QUICK_VIEW_HERO_HEIGHT = 320;
const QUICK_VIEW_BORDER_RADIUS = 22;
const QUICK_VIEW_HORIZONTAL_PADDING = 12;
const QUICK_VIEW_ENTRANCE_MS = 320;
const QUICK_VIEW_SETTLE_MS = 260;
const QUICK_VIEW_EXIT_MS = 240;
const QUICK_VIEW_FLICK_VELOCITY = 0.45;
const QUICK_VIEW_DISMISS_DRAG = 0.16;
/* Footer: variant title + price + "Inclusive of all taxes" (3 lines ≈ 52px)
 * plus padding — sized so the taxes line is never clipped. */
const BOTTOM_CTA_HEIGHT = 78;

export function derivePerUnitLine(
  unitTitle: string,
  priceInPaise: number,
): string | null {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(g|kg|ml|l|pc|pcs)\s*$/i.exec(unitTitle);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (!Number.isFinite(value) || value <= 0 || priceInPaise <= 0) return null;

  let baseValue = value;
  let baseUnit = unit;
  if (unit === 'kg') {
    baseValue = value * 1000;
    baseUnit = 'g';
  } else if (unit === 'l') {
    baseValue = value * 1000;
    baseUnit = 'ml';
  }

  if (baseUnit === 'pc' || baseUnit === 'pcs') {
    const perPc = (priceInPaise / 100) / value;
    return `₹${trimNumber(perPc)} / pc`;
  }

  const per100 = ((priceInPaise / 100) * 100) / baseValue;
  return `₹${trimNumber(per100)} / 100 ${baseUnit}`;
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0$/, '');
}

export interface CategoryProductPagerProps {
  visible: boolean;
  categorySlug?: string | null;
  categoryName?: string;
  products: ProductListItem[];
  initialProductSlug?: string | null;
  onClose: () => void;
  relatedProducts?: ProductListItem[];
  onOpenProduct?: (slug: string) => void;
  onOpenCategory?: (slug: string) => void;
}

export function CategoryProductPager({
  visible,
  categorySlug,
  categoryName,
  products,
  initialProductSlug,
  onClose,
  relatedProducts,
  onOpenProduct,
  onOpenCategory,
}: CategoryProductPagerProps) {
  void categoryName;

  const insets = useSafeAreaInsets();

  /*
   * Live viewport, not `Dimensions` at module load. The pager is a full-screen
   * Modal; without this cap a desktop browser sized its cards to the whole
   * window while the rest of the app lives in a 480px shell.
   */
  const { contentWidth } = useResponsive();
  const { height: windowHeight } = useWindowDimensions();
  const CARD_WIDTH = contentWidth - 2 * (INNER_PEEK + INNER_GAP);
  const SNAP_INTERVAL = CARD_WIDTH + INNER_GAP;
  const PAGER_PAD = (contentWidth - CARD_WIDTH) / 2;
  const SCREEN_HEIGHT = windowHeight;

  const categoryProducts = useMemo(() => {
    if (!categorySlug) return products;
    return products.filter((product) =>
      product.categories?.some((category) => category.slug === categorySlug),
    );
  }, [products, categorySlug]);

  const slides = useMemo(
    () => (categoryProducts.length > 0 ? categoryProducts : products),
    [categoryProducts, products],
  );

  const initialIndex = useMemo(() => {
    if (!initialProductSlug) return 0;
    const found = slides.findIndex((product) => product.slug === initialProductSlug);
    return found >= 0 ? found : 0;
  }, [slides, initialProductSlug]);

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [pagerHeight, setPagerHeight] = useState(0);
  const [variantSelections, setVariantSelections] = useState<Record<string, string>>({});

  const selectVariant = useCallback((slug: string, variantId: string | null) => {
    setVariantSelections((previous) => ({
      ...previous,
      [slug]: variantId ?? '',
    }));
  }, []);

  const listRef = useRef<FlatList<ProductListItem>>(null);
  const activeScrollY = useRef(0);
  const dragStart = useRef(0);
  const hasEntered = useRef(false);
  const closingRef = useRef(false);

  /*
   * True while the user is touching the image carousel inside a slide.
   * The outer product pager then releases horizontal scrolling so gallery
   * swipes page images instead of flipping products.
   */
  const [galleryGesture, setGalleryGesture] = useState(false);

  const deckTy = useSharedValue(SCREEN_HEIGHT);

  const snapOffsets = useMemo(
    () => slides.map((_, index) => SNAP_INTERVAL * index),
    [slides],
  );

  const categoryIndex = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: catalogApi.listCategories,
    staleTime: 5 * 60_000,
  });
  const categories: CategorySummary[] = categoryIndex.data ?? [];

  useEffect(() => {
    if (!visible) return;
    setActiveIndex(initialIndex);
    activeScrollY.current = 0;
  }, [visible, initialIndex]);

  useEffect(() => {
    if (visible && !hasEntered.current) {
      hasEntered.current = true;
      closingRef.current = false;
      deckTy.value = SCREEN_HEIGHT;
      deckTy.value = withTiming(0, {
        duration: QUICK_VIEW_ENTRANCE_MS,
        easing: Easing.out(Easing.cubic),
      });
    }

    if (!visible) {
      hasEntered.current = false;
      closingRef.current = false;
    }
  }, [visible, deckTy]);

  const snapDeckToRest = useCallback(() => {
    deckTy.value = withTiming(0, {
      duration: QUICK_VIEW_SETTLE_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [deckTy]);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    deckTy.value = withTiming(SCREEN_HEIGHT, {
      duration: QUICK_VIEW_EXIT_MS,
      easing: Easing.in(Easing.cubic),
    });
    setTimeout(onClose, QUICK_VIEW_EXIT_MS + 20);
  }, [deckTy, onClose]);

  useEffect(() => {
    // BackHandler is Android-only; importing its API on web logs a warning
    // ("BackHandler is not supported on web"). Web closes the deck via the
    // close button / backdrop, so only subscribe on Android.
    if (!visible || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [visible, handleClose]);

  /*
   * Only capture a downward vertical gesture when the active product
   * ScrollView is already at the top. Upward gestures remain owned by
   * the ScrollView, so product details can actually scroll.
   */
  const isVerticalDownIntent = (
    gesture: PanResponderGestureState,
    min: number,
  ) =>
    gesture.dy > min && gesture.dy > Math.abs(gesture.dx);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) =>
        activeScrollY.current <= 1 &&
        isVerticalDownIntent(gesture, 7),
      onMoveShouldSetPanResponder: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) =>
        activeScrollY.current <= 1 &&
        isVerticalDownIntent(gesture, 9),
      onPanResponderGrant: () => {
        dragStart.current = deckTy.value;
      },
      onPanResponderMove: (_event, gesture) => {
        const next = dragStart.current + gesture.dy;
        deckTy.value = Math.min(Math.max(next, 0), SCREEN_HEIGHT);
      },
      onPanResponderRelease: (_event, gesture) => {
        const current = dragStart.current + gesture.dy;
        const flickDown = gesture.vy > QUICK_VIEW_FLICK_VELOCITY;
        const dismissDrag = SCREEN_HEIGHT * QUICK_VIEW_DISMISS_DRAG;
        if (flickDown || current > dismissDrag) {
          handleClose();
        } else {
          snapDeckToRest();
        }
      },
      onPanResponderTerminate: () => snapDeckToRest(),
    }),
  ).current;

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      deckTy.value,
      [0, SCREEN_HEIGHT],
      [0.78, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const deckStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: deckTy.value }],
  }));

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const item = viewableItems.find((candidate) => candidate.isViewable);
      if (item?.index != null) {
        setActiveIndex(item.index);
        activeScrollY.current = 0;
      }
    },
  ).current;

  const cardTopGap = insets.top + CARD_TOP_EXTRA;
  const cardBottomGap = Math.max(insets.bottom, 10) + CARD_BOTTOM_EXTRA;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View
        testID="deck-backdrop"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: '#000000',
          },
          backdropStyle,
        ]}
      />

      <Pressable
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        onPress={handleClose}
        accessibilityLabel="Close product browser"
      />

      <Animated.View
        testID="deck-surface"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            overflow: 'hidden',
          },
          deckStyle,
        ]}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: cardTopGap,
            bottom: cardBottomGap,
            overflow: 'hidden',
          }}
          onLayout={(event) => {
            const next = event.nativeEvent.layout.height;
            setPagerHeight((previous) =>
              Math.abs(previous - next) > 1 ? next : previous,
            );
          }}
          {...panResponder.panHandlers}
        >
          <FlatList
            ref={listRef}
            data={slides}
            horizontal
            /*
             * While the user is swiping the image carousel inside a slide,
             * the outer product pager must not claim the same horizontal
             * gesture — otherwise gallery swipes flip products instead of
             * images. The slide reports touches via onCarouselTouchStart/End.
             */
            scrollEnabled={!galleryGesture}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            decelerationRate="fast"
            snapToOffsets={snapOffsets}
            snapToAlignment="start"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: PAGER_PAD }}
            initialScrollIndex={initialIndex}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            getItemLayout={(_, index) => ({
              length: SNAP_INTERVAL,
              offset: PAGER_PAD + SNAP_INTERVAL * index,
              index,
            })}
            keyExtractor={(item) => item.id ?? item.slug}
            renderItem={({ item, index }) => (
              <View
                style={{
                  width: CARD_WIDTH,
                  height: pagerHeight > 0 ? pagerHeight : undefined,
                  marginRight: INNER_GAP,
                  overflow: 'hidden',
                  borderRadius: QUICK_VIEW_BORDER_RADIUS,
                  backgroundColor: CARD_BG,
                }}
              >
                <ProductSlide
                  product={item}
                  isActive={index === activeIndex}
                  slideHeight={pagerHeight}
                  selectedVariantId={variantSelections[item.slug] ?? null}
                  onSelectVariant={selectVariant}
                  onOpenCategory={onOpenCategory}
                  onOpenProduct={onOpenProduct}
                  categories={categories}
                  relatedProducts={relatedProducts ?? []}
                  scrollOffsetRef={activeScrollY}
                  bottomInset={insets.bottom}
                  onGalleryGesture={setGalleryGesture}
                />
                <SlideChrome
                  product={item}
                  onClose={handleClose}
                />
              </View>
            )}
          />
        </View>
      </Animated.View>
    </Modal>
  );
}

export interface ProductQuickViewProps {
  slug: string | null;
  onClose: () => void;
  pagerProducts: ProductListItem[];
  relatedProducts: ProductListItem[];
  onOpenProduct: (slug: string) => void;
  onOpenCategory?: (slug: string) => void;
}

export function ProductQuickView({
  slug,
  onClose,
  pagerProducts,
  relatedProducts,
  onOpenProduct,
  onOpenCategory,
}: ProductQuickViewProps) {
  return (
    <CategoryProductPager
      visible={slug != null}
      products={pagerProducts}
      initialProductSlug={slug}
      onClose={onClose}
      relatedProducts={relatedProducts}
      onOpenProduct={onOpenProduct}
      onOpenCategory={onOpenCategory}
    />
  );
}

/* ============================================================
   PRODUCT SLIDE
============================================================ */

function SlideChrome({
  product,
  onClose,
}: {
  product: ProductListItem;
  onClose: () => void;
}) {
  const { isSaved, toggle } = useWishlist();
  const saved = isSaved(product.slug);

  const handleShare = () => {
    void Share.share({ message: `${product.title} — Sakya Farms` });
  };

  /*
   * The heart writes to the SERVER wishlist (the same book the Wishlist
   * screen reads). Guests are sent to sign in first, with this surface as the
   * place to come back to.
   */
  const handleToggleWishlist = () => {
    void toggle(product.slug).then((result) => {
      if (result === 'auth-required') {
        useAuthStore.getState().setPendingRedirect('/(shop)');
        router.push('/(auth)/phone');
      }
    });
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          height: QUICK_VIEW_HANDLE_HEIGHT,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 42,
            height: 4,
            borderRadius: 2,
            backgroundColor: 'rgba(255,255,255,0.75)',
          }}
        />
      </View>

      <View
        style={{
          height: QUICK_VIEW_HEADER_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 10,
        }}
      >
        <RoundHeaderButton
          label="Close product browser"
          onPress={onClose}
        >
          <Ionicons name="chevron-down" size={22} color={TEXT} />
        </RoundHeaderButton>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <RoundHeaderButton
            label={saved ? 'Remove from saved' : 'Save product'}
            onPress={handleToggleWishlist}
          >
            <Ionicons
              name={saved ? 'heart' : 'heart-outline'}
              size={19}
              color={saved ? '#B4612F' : TEXT}
            />
          </RoundHeaderButton>

          {/* The old "Product image search" button had `onPress={() => undefined}`
              — a visible control that did nothing. Removed rather than faked. */}

          <RoundHeaderButton label="Share product" onPress={handleShare}>
            <Ionicons name="share-outline" size={18} color={TEXT} />
          </RoundHeaderButton>
        </View>
      </View>
    </View>
  );
}

function RoundHeaderButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.94)',
      }}
    >
      {children}
    </Pressable>
  );
}

function ProductSlide({
  product,
  isActive,
  slideHeight,
  selectedVariantId,
  onSelectVariant,
  onOpenCategory,
  onOpenProduct,
  categories,
  relatedProducts,
  scrollOffsetRef,
  bottomInset,
  onGalleryGesture,
}: {
  product: ProductListItem;
  isActive: boolean;
  slideHeight: number;
  selectedVariantId: string | null;
  onSelectVariant: (slug: string, variantId: string | null) => void;
  onOpenCategory?: (slug: string) => void;
  onOpenProduct?: (slug: string) => void;
  categories: CategorySummary[];
  relatedProducts: ProductListItem[];
  scrollOffsetRef: MutableRefObject<number>;
  bottomInset: number;
  onGalleryGesture?: (active: boolean) => void;
}) {
  const detail = useQuery({
    queryKey: ['catalog', 'product', product.slug],
    queryFn: () => catalogApi.getProduct(product.slug),
    enabled: isActive,
    staleTime: 120_000,
  });

  if (detail.isPending) {
    return (
      <View
        style={{
          flex: 1,
          height: slideHeight > 0 ? slideHeight : undefined,
          backgroundColor: CARD_BG,
        }}
      >
        <View style={{ height: QUICK_VIEW_HERO_HEIGHT, backgroundColor: '#ECECE8' }} />
        <View style={{ padding: 12 }}>
          <View style={{ height: 12, width: '45%', borderRadius: 6, backgroundColor: '#ECECE8' }} />
          <View style={{ marginTop: 10, height: 20, width: '84%', borderRadius: 7, backgroundColor: '#ECECE8' }} />
          <View style={{ marginTop: 8, height: 14, width: '64%', borderRadius: 6, backgroundColor: '#ECECE8' }} />
          <View style={{ marginTop: 18, height: 70, borderRadius: 11, backgroundColor: '#ECECE8' }} />
        </View>
      </View>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Ionicons name="leaf-outline" size={38} color={BRAND} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: TEXT }}>
          Could not load product
        </Text>
        <Pressable
          onPress={() => detail.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: BRAND,
            backgroundColor: 'rgba(255,255,255,0.96)',
            paddingHorizontal: 18,
            paddingVertical: 8,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: '800', color: BRAND }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ProductSlideContent
      product={detail.data}
      slideHeight={slideHeight}
      selectedVariantId={selectedVariantId}
      onSelectVariant={onSelectVariant}
      onOpenCategory={onOpenCategory}
      onOpenProduct={onOpenProduct}
      categories={categories}
      relatedProducts={relatedProducts}
      scrollOffsetRef={scrollOffsetRef}
      bottomInset={bottomInset}
      onGalleryGesture={onGalleryGesture}
    />
  );
}

function ProductSlideContent({
  product,
  slideHeight,
  selectedVariantId,
  onSelectVariant,
  onOpenCategory,
  onOpenProduct,
  categories,
  relatedProducts,
  scrollOffsetRef,
  bottomInset,
  onGalleryGesture,
}: {
  product: ProductDetail;
  slideHeight: number;
  selectedVariantId: string | null;
  onSelectVariant: (slug: string, variantId: string | null) => void;
  onOpenCategory?: (slug: string) => void;
  onOpenProduct?: (slug: string) => void;
  categories: CategorySummary[];
  relatedProducts: ProductListItem[];
  scrollOffsetRef: MutableRefObject<number>;
  bottomInset: number;
  onGalleryGesture?: (active: boolean) => void;
}) {
  const variants = product.variants?.filter((variant) => variant.isAvailable) ?? [];
  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ??
    variants[0] ??
    null;

  const productRecord = product as ProductDetail & {
    rating?: number | null;
    reviewCount?: number | null;
    deliveryTimeMinutes?: number | null;
    isSponsored?: boolean;
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
  };

  const handleViewDetails = () => {
    onOpenProduct?.(product.slug);
  };

  return (
    <View
      style={{
        height: slideHeight > 0 ? slideHeight : undefined,
        flex: slideHeight > 0 ? undefined : 1,
        backgroundColor: CARD_BG,
      }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: BOTTOM_CTA_HEIGHT + Math.max(bottomInset, 1) + 2,
        }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        bounces
        scrollEventThrottle={16}
        onScroll={onScroll}
      >
        <ProductImageGallery
          product={product}
          fixedHeight={QUICK_VIEW_HERO_HEIGHT}
          onCarouselTouchStart={() => onGalleryGesture?.(true)}
          onCarouselTouchEnd={() => onGalleryGesture?.(false)}
        />

        <View style={{ paddingHorizontal: QUICK_VIEW_HORIZONTAL_PADDING }}>
          <ProductFeatureStrip product={product} />

          <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            {productRecord.deliveryTimeMinutes != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="time-outline" size={13} color={MUTED} />
                <Text style={{ color: MUTED, fontSize: 10.5, fontWeight: '600' }}>
                  {productRecord.deliveryTimeMinutes} mins
                </Text>
              </View>
            ) : null}

            {productRecord.rating != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="star" size={11} color="#D9A52B" />
                <Text style={{ color: '#D9A52B', fontSize: 10.5, fontWeight: '800' }}>
                  {productRecord.rating.toFixed(1)}
                </Text>
                {productRecord.reviewCount != null ? (
                  <Text style={{ color: MUTED, fontSize: 10 }}>
                    {productRecord.reviewCount >= 1000
                      ? `${(productRecord.reviewCount / 1000).toFixed(1)} lac`
                      : productRecord.reviewCount}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          <Text
            style={{
              color: TEXT,
              fontSize: 17,
              lineHeight: 21,
              fontWeight: '800',
              marginTop: 7,
            }}
          >
            {product.title}
          </Text>

          {variants.length > 0 ? (
            <VariantSelector
              variants={variants}
              selectedVariantId={selectedVariant?.id ?? null}
              onSelect={(variantId) => onSelectVariant(product.slug, variantId)}
            />
          ) : null}

          <ReplacementRow />

          {relatedProducts.length > 0 ? (
            <SimilarProductsRail
              items={relatedProducts}
              currentSlug={product.slug}
              onOpenProduct={onOpenProduct}
            />
          ) : null}

          <ProductDetailsBlock product={product} onViewDetails={handleViewDetails} />

          <CustomerTrustRow />

          <DeckTrustStrip />

          <ExploreCategories
            product={product}
            categories={categories}
            onOpenCategory={onOpenCategory}
          />
        </View>
      </ScrollView>

      <BottomAddToCart
        product={product}
        selectedVariant={selectedVariant}
        variants={variants}
        bottomInset={bottomInset}
      />
    </View>
  );
}



function ProductFeatureStrip({ product }: { product: ProductDetail }) {
  const categoryFeatures = deckFeaturesFor(
    product.categories?.map((category) => category.slug) ?? [],
  );

  const fallbackFeatures = [
    { label: 'Fresh & quality checked', icon: 'checkmark-circle-outline' as const },
    { label: 'Carefully sourced', icon: 'leaf-outline' as const },
    { label: 'Packed with care', icon: 'cube-outline' as const },
    { label: 'Trusted by customers', icon: 'heart-outline' as const },
  ];

  const features = [...categoryFeatures, ...fallbackFeatures]
    .filter(
      (feature, index, list) =>
        list.findIndex((candidate) => candidate.label === feature.label) === index,
    )
    .slice(0, 4);

  return (
    <View style={{ marginTop: 6, paddingVertical: 6, paddingHorizontal: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {features.map((feature) => (
          <View
            key={feature.label}
            style={{
              width: '24%',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#EAF3EA',
              }}
            >
              <Ionicons name={feature.icon} size={15} color={BRAND} />
            </View>
            <Text
              numberOfLines={2}
              style={{
                marginTop: 4,
                color: TEXT,
                fontSize: 8.5,
                lineHeight: 10.5,
                fontWeight: '700',
                textAlign: 'center',
              }}
            >
              {feature.label}
            </Text>
          </View>
        ))}
      </View>

    </View>
  );
}


function VariantSelector({
  variants,
  selectedVariantId,
  onSelect,
}: {
  variants: NonNullable<ProductDetail['variants']>;
  selectedVariantId: string | null;
  onSelect: (variantId: string) => void;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: TEXT, fontSize: 12.5, fontWeight: '800', marginBottom: 7 }}>
        Select Unit
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {variants.map((variant) => {
          const meta = variant as typeof variant & { mrpInPaise?: number | null };
          const mrp = meta.mrpInPaise ?? null;
          const discount =
            mrp != null && mrp > variant.priceInPaise
              ? Math.round((1 - variant.priceInPaise / mrp) * 100)
              : null;
          const selected = variant.id === selectedVariantId;

          return (
            <Pressable
              key={variant.id}
              onPress={() => onSelect(variant.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{
                minWidth: 112,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 11,
                borderWidth: selected ? 1.5 : 1,
                borderColor: selected ? '#6A9E6A' : '#E8E7E3',
                backgroundColor: selected ? '#F4FAF1' : '#FFFFFF',
              }}
            >
              <Text style={{ color: TEXT, fontSize: 11.5, fontWeight: '800' }}>
                {variant.title}
              </Text>
              <View style={{ marginTop: 3, flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                <Text style={{ color: TEXT, fontSize: 13, fontWeight: '800' }}>
                  {formatMoney(variant.priceInPaise)}
                </Text>
                {mrp != null && mrp > variant.priceInPaise ? (
                  <Text style={{ color: MUTED, fontSize: 9.5, textDecorationLine: 'line-through' }}>
                    {formatMoney(mrp)}
                  </Text>
                ) : null}
              </View>
              {discount != null ? (
                <Text style={{ color: '#4E7B50', fontSize: 9.5, fontWeight: '800', marginTop: 2 }}>
                  {discount}% OFF on MRP
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ReplacementRow() {
  return (
    <Pressable
      style={{
        marginTop: 8,
        minHeight: 48,
        borderRadius: 11,
        backgroundColor: '#FAFAF7',
        borderWidth: 1,
        borderColor: '#F0EEE9',
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 25,
          height: 25,
          borderRadius: 13,
          backgroundColor: '#F1F1EA',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="shield-checkmark-outline" size={14} color={TEXT} />
      </View>
      <Text style={{ flex: 1, color: TEXT, fontSize: 11.5, fontWeight: '700', marginLeft: 8 }}>
        72 hours only replacement
      </Text>
      <Ionicons name="chevron-forward" size={17} color={MUTED} />
    </Pressable>
  );
}

function SimilarProductsRail({
  items,
  currentSlug,
  onOpenProduct,
}: {
  items: ProductListItem[];
  currentSlug: string;
  onOpenProduct?: (slug: string) => void;
}) {
  const visibleItems = items.filter((item) => item.slug !== currentSlug).slice(0, 5);
  if (visibleItems.length === 0) return null;

  return (
    <View style={{ marginTop: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
        <Text style={{ flex: 1, color: TEXT, fontSize: 14, fontWeight: '900' }}>
          Similar products
        </Text>
        <Ionicons name="chevron-forward" size={17} color={MUTED} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {visibleItems.map((item) => (
          <Pressable
            key={item.slug}
            onPress={() => onOpenProduct?.(item.slug)}
            style={{ width: 78 }}
          >
            <Image
              source={item.primaryImageUrl ? { uri: cdnImageUri(item.primaryImageUrl, 160) ?? item.primaryImageUrl } : undefined}
              style={{ width: 78, height: 78, borderRadius: 10, backgroundColor: '#F3EDE3' }}
              contentFit="cover"
              cachePolicy="disk"
              transition={100}
            />
            <Text
              numberOfLines={2}
              style={{ color: TEXT, fontSize: 9.5, fontWeight: '600', marginTop: 3, lineHeight: 12 }}
            >
              {item.title}
            </Text>
            {item.price?.minInPaise != null ? (
              <Text style={{ color: TEXT, fontSize: 10.5, fontWeight: '800', marginTop: 1 }}>
                {formatMoney(item.price.minInPaise)}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function ProductDetailsBlock({
  product,
  onViewDetails,
}: {
  product: ProductDetail;
  onViewDetails: () => void;
}) {
  return (
    <View style={{ marginTop: 8 }}>
      {product.description ? (
        <Text
          numberOfLines={4}
          style={{ color: MUTED, fontSize: 11.5, lineHeight: 17 }}
        >
          {product.description}
        </Text>
      ) : null}

      <Pressable
        onPress={onViewDetails}
        accessibilityRole="button"
        accessibilityLabel="View product details"
        style={{
          minHeight: 40,
          marginTop: product.description ? 4 : 0,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: '#EEECE7',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={{ flex: 1, color: TEXT, fontSize: 12.5, fontWeight: '800' }}>
          View details
        </Text>
        <Ionicons name="chevron-forward" size={17} color={MUTED} />
      </Pressable>
    </View>
  );
}

function CustomerTrustRow() {
  return (
    <View
      style={{
        marginTop: 8,
        minHeight: 40,
        borderRadius: 10,
        backgroundColor: '#F7FAF5',
        borderWidth: 1,
        borderColor: '#E5EDE1',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
      }}
    >
      <Ionicons name="people-outline" size={17} color={BRAND} />
      <Text style={{ marginLeft: 7, color: TEXT, fontSize: 11.5, fontWeight: '800' }}>
        Trusted by 1.8 lakh customers
      </Text>
    </View>
  );
}

const TRUST_ITEMS: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
}[] = [
  { icon: 'shield-checkmark-outline', label: '100% genuine products' },
  { icon: 'lock-closed-outline', label: 'Secure payment' },
  { icon: 'chatbubble-ellipses-outline', label: '24/7 support' },
  { icon: 'cash-outline', label: 'COD available' },
  { icon: 'bicycle-outline', label: 'Free shipping above ₹499' },
];

function DeckTrustStrip() {
  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: '#FAF8F2',
        paddingHorizontal: 9,
        paddingVertical: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 6,
      }}
    >
      {TRUST_ITEMS.map((item) => (
        <View
          key={item.label}
          style={{
            width: '50%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingRight: 5,
          }}
        >
          <Ionicons name={item.icon} size={12} color={BRAND} />
          <Text numberOfLines={1} style={{ color: TEXT, fontSize: 9, fontWeight: '600', flex: 1 }}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ExploreCategories({
  product,
  categories,
  onOpenCategory,
}: {
  product: ProductDetail;
  categories: CategorySummary[];
  onOpenCategory?: (slug: string) => void;
}) {
  const nameBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) map.set(category.slug, category.name);
    return map;
  }, [categories]);

  const slugs = product.categories?.map((category) => category.slug).slice(0, 3) ?? [];
  if (slugs.length === 0) return null;

  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {slugs.map((slug) => {
          const artwork = getCategoryImage(slug);
          return (
            <Pressable
              key={slug}
              onPress={() => onOpenCategory?.(slug)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: '#FFFFFF',
                paddingLeft: 5,
                paddingRight: 9,
                paddingVertical: 4,
              }}
            >
              {artwork ? (
                <Image
                  source={artwork}
                  style={{ width: 22, height: 22, borderRadius: 11 }}
                  contentFit="cover"
                  cachePolicy="disk"
                />
              ) : (
                <View
                  style={{
                    width: 22,
                    height: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 11,
                    backgroundColor: '#E4EFE7',
                  }}
                >
                  <Ionicons name={FALLBACK_CATEGORY_ICON} size={13} color={BRAND} />
                </View>
              )}
              <Text style={{ color: TEXT, fontSize: 10.5, fontWeight: '700' }}>
                {nameBySlug.get(slug) ?? slug}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function BottomAddToCart({
  product,
  selectedVariant,
  variants,
  bottomInset,
}: {
  product: ProductDetail;
  selectedVariant: ProductDetail['variants'][number] | null;
  variants: ProductDetail['variants'];
  bottomInset: number;
}) {
  const { quantity, add, addVariant, increment, decrement, resolving } = useProductAdd(product);
  const meta = selectedVariant as (typeof selectedVariant & { mrpInPaise?: number | null }) | null;
  const perUnit = selectedVariant
    ? derivePerUnitLine(selectedVariant.title, selectedVariant.priceInPaise)
    : null;

  const handleAdd = () => {
    if (!selectedVariant || !product.isAvailable) return;
    if (variants.length > 1) {
      addVariant({
        id: selectedVariant.id,
        priceInPaise: selectedVariant.priceInPaise,
        title: selectedVariant.title,
      });
      return;
    }
    void add();
  };

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        minHeight: BOTTOM_CTA_HEIGHT + Math.max(bottomInset, 0),
        paddingHorizontal: QUICK_VIEW_HORIZONTAL_PADDING,
        paddingTop: 14,
        paddingBottom: Math.max(bottomInset, 1),
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: 'rgba(228,226,220,0.70)',
        shadowColor: '#000000',
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: -4 },
        elevation: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {selectedVariant ? (
          <>
            <Text style={{ color: TEXT, fontSize: 12, fontWeight: '800' }} numberOfLines={1}>
              {selectedVariant.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
              <Text style={{ color: TEXT, fontSize: 17, fontWeight: '900', marginTop: 0 }}>
                {formatMoney(selectedVariant.priceInPaise)}
              </Text>
              {meta?.mrpInPaise != null && meta.mrpInPaise > selectedVariant.priceInPaise ? (
                <Text style={{ color: MUTED, fontSize: 9.5, textDecorationLine: 'line-through' }}>
                  {formatMoney(meta.mrpInPaise)}
                </Text>
              ) : null}
            </View>
            <Text style={{ color: MUTED, fontSize: 9, marginTop: 2 }} numberOfLines={1}>
              {perUnit ? `${perUnit} · Inclusive of all taxes` : 'Inclusive of all taxes'}
            </Text>
          </>
        ) : (
          <Text style={{ color: MUTED, fontSize: 12, fontWeight: '700' }}>
            Currently unavailable
          </Text>
        )}
      </View>

      {quantity > 0 ? (
        <QuantityStepper
          quantity={quantity}
          disabled={resolving || !product.isAvailable}
          width={110}
          onAdd={handleAdd}
          onIncrement={() => void increment()}
          onDecrement={decrement}
        />
      ) : (
        <Pressable
          testID="deck-add"
          disabled={!selectedVariant || resolving || !product.isAvailable}
          onPress={handleAdd}
          accessibilityRole="button"
          accessibilityLabel="Add to cart"
          style={{
            height: 42,
            minWidth: 112,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 15,
            backgroundColor:
              !selectedVariant || resolving || !product.isAvailable
                ? '#B9BDB4'
                : CTA_GREEN,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>
            {resolving ? 'Adding…' : 'Add to cart'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
