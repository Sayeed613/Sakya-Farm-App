import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
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

import { catalogApi } from '../../api/catalog';
import type {
  ProductDetail,
  ProductListItem,
} from '@sakya/types';

import { formatMoney } from '../../lib/format';
import { useProductAdd } from '../../lib/use-product-add';
import { VariantPickerSheet, type VariantPickerState } from './VariantPickerSheet';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const BRAND = '#0B594C';
const BG = '#F6F6FC';
const TEXT = '#292D2B';
const MUTED = '#858982';
const BORDER = '#E9E9E7';

/* ============================================================
   PRODUCT DECK MEASUREMENTS — named constants, no magic numbers.

   GEOMETRY MODEL (keeps the CTA on screen in BOTH states):

     CONTAINER  bottom-anchored, height = EXPANDED_HEIGHT, overflow
                hidden. Its bottom edge IS the device bottom, so a
                gap below the deck is geometrically impossible.
                ONE shared value (deckTy) drives everything:
                  0 ............ expanded
                  SHIFT ........ collapsed (quick view)
                  > SHIFT ...... dismissal (deck leaves with finger)

     FOOTER     lives inside the container, absolutely at its
                bottom, with a UI-thread counter-translate of
                −min(deckTy, SHIFT). Collapse: container slides
                down, footer slides back up — pinned to the device
                bottom in both states. Dismissal: the counter-
                translate saturates, so the footer travels down
                WITH the deck and leaves the screen together.

     Overflow   dragging below the collapsed snap moves deckTy
                past SHIFT — the whole deck (rounded face + footer)
                exits with the finger.
============================================================ */

/** Deck's top inset when fully expanded (status-bar aware at runtime). */
const QUICK_VIEW_EXPANDED_TOP_INSET = 24;
/** Collapsed (quick view) deck height. Clamped for small screens. */
const QUICK_VIEW_COLLAPSED_HEIGHT = Math.min(620, SCREEN_HEIGHT - 120);
/** Full deck height: one surface, bottom-anchored. */
const QUICK_VIEW_EXPANDED_HEIGHT = SCREEN_HEIGHT - QUICK_VIEW_EXPANDED_TOP_INSET;
/** Hero image height — identical in both states so switching products never resizes the deck. */
const QUICK_VIEW_HERO_HEIGHT = 300;
/** Header control strip height. */
const QUICK_VIEW_HEADER_HEIGHT = 56;
/** Drag-handle strip height (the pan zone above the header). */
const QUICK_VIEW_HANDLE_HEIGHT = 28;
/** Fixed Add-to-Cart bar: content height before the device bottom inset. */
const QUICK_VIEW_CTA_MIN_HEIGHT = 84;
/** Deck top-corner radius. */
const QUICK_VIEW_BORDER_RADIUS = 24;
/** Deck horizontal padding. */
const QUICK_VIEW_HORIZONTAL_PADDING = 14;

/** Entrance: bottom → collapsed. Single timing animation, no bounce. */
const QUICK_VIEW_ENTRANCE_MS = 320;
/** Snap settling (expand/collapse after release). */
const QUICK_VIEW_SETTLE_MS = 280;
/** Dismissal: collapsed → off-screen, then unmount. */
const QUICK_VIEW_EXIT_MS = 260;
/** Flick velocity (px/ms) counting as directional intent. */
const QUICK_VIEW_FLICK_VELOCITY = 0.75;
/** Displacement past the collapsed snap that commits a dismissal. */
const QUICK_VIEW_DISMISS_BUFFER = 110;

/** deckTy snaps: 0 = expanded; SHIFT = collapsed. */
const DECK_EXPANDED = 0;
const DECK_SHIFT = QUICK_VIEW_EXPANDED_HEIGHT - QUICK_VIEW_COLLAPSED_HEIGHT;
/** Fully below the screen — the entrance start / dismissal target. */
const DECK_OFFSCREEN = QUICK_VIEW_EXPANDED_HEIGHT;

/* ============================================================
   PRODUCT CONTEXT

   Whatever products the caller passes become the slides.
   Veg = 10 products → 10 slides (1/10 … 10/10). Search results,
   Fresh, filtered listings — the current context IS the deck.
   Never the whole catalog, never an injected item.
============================================================ */

export interface CategoryProductPagerProps {
  visible: boolean;

  /** Optional client-side narrowing by category slug (slugs are the public id). */
  categorySlug?: string | null;

  categoryName?: string;

  products: ProductListItem[];

  initialProductSlug?: string | null;

  onClose: () => void;

  /** Real cross-sell items for the "Similar products" rail. */
  relatedProducts?: ProductListItem[];

  /** View-details tap → full product page. */
  onOpenProduct?: (slug: string) => void;
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
}: CategoryProductPagerProps) {
  /*
   * ONLY PRODUCTS FROM THE GIVEN CONTEXT (when a category is provided).
   * Slugs — not internal ids — are the public category identifier.
   */
  const categoryProducts = useMemo(() => {
    if (!categorySlug) return products;
    return products.filter((product) =>
      product.categories?.some(
        (category) => category.slug === categorySlug,
      ),
    );
  }, [products, categorySlug]);

  const slides = useMemo(() => {
    if (categoryProducts.length > 0) {
      return categoryProducts;
    }
    return products;
  }, [categoryProducts, products]);

  const initialIndex = useMemo(() => {
    if (!initialProductSlug) return 0;
    const index = slides.findIndex(
      (product) => product.slug === initialProductSlug,
    );
    return index >= 0 ? index : 0;
  }, [slides, initialProductSlug]);

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [expanded, setExpanded] = useState(false);
  /**
   * Pager viewport height, measured once. Slides get this as an EXPLICIT
   * pixel height — the VirtualizedList's cell-renderer wrappers size to
   * content, so flex alone cannot bound a slide; explicit pixels can.
   */
  const [pagerHeight, setPagerHeight] = useState(0);
  /**
   * Selected variant per product slug. Lives here (deck level) so the
   * expanded-state chips and the fixed footer always agree — there is
   * ONE purchasable selection per product at any moment.
   */
  const [variantSelections, setVariantSelections] = useState<Record<string, string>>({});
  const selectVariant = useCallback((slug: string, variantId: string | null) => {
    setVariantSelections((previous) => ({
      ...previous,
      [slug]: variantId ?? '',
    }));
  }, []);

  /*
   * GESTURE STATE MIRRORS — the PanResponder is created once, so its
   * callbacks read refs, never stale closure state. No re-renders happen
   * per gesture frame: deckTy is a shared value written on the UI thread.
   */
  const expandedRef = useRef(false);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  /** The active slide's live scroll offset (for pull-down gesture transfer). */
  const activeScrollYRef = useRef(0);

  const listRef = useRef<FlatList<ProductListItem>>(null);

  useEffect(() => {
    if (!visible) return;
    setActiveIndex(initialIndex);
  }, [visible, initialIndex]);

  /*
   * DECK POSITION — ONE shared value for the whole surface:
   *   0 = expanded, DECK_SHIFT = collapsed, offscreen = gone.
   * The entrance runs ONCE per open (timing, no bounce); switching
   * products never touches it; expanded/collapsed state survives
   * product switches.
   */
  const deckTy = useSharedValue(DECK_OFFSCREEN);
  const hasEntered = useRef(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible && !hasEntered.current) {
      hasEntered.current = true;
      closingRef.current = false;
      deckTy.value = DECK_OFFSCREEN;
      deckTy.value = withTiming(DECK_EXPANDED + DECK_SHIFT, {
        duration: QUICK_VIEW_ENTRANCE_MS,
        easing: Easing.out(Easing.cubic),
      });
      setExpanded(false);
    }
    if (!visible) {
      hasEntered.current = false;
      closingRef.current = false;
    }
  }, [visible, deckTy]);

  const snapDeckTo = useCallback(
    (target: number) => {
      deckTy.value = withTiming(target, {
        duration: QUICK_VIEW_SETTLE_MS,
        easing: Easing.out(Easing.cubic),
      });
    },
    [deckTy],
  );

  const collapse = useCallback(() => {
    setExpanded(false);
    snapDeckTo(DECK_EXPANDED + DECK_SHIFT);
  }, [snapDeckTo]);

  const expand = useCallback(() => {
    setExpanded(true);
    snapDeckTo(DECK_EXPANDED);
  }, [snapDeckTo]);

  /**
   * DISMISSAL — the deck (footer included) animates down, the backdrop
   * fades with it, and only after the exit completes does the Modal
   * unmount. The parent's onClose runs once, after the surface is gone.
   */
  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    deckTy.value = withTiming(DECK_OFFSCREEN, {
      duration: QUICK_VIEW_EXIT_MS,
      easing: Easing.in(Easing.cubic),
    });
    setTimeout(() => {
      onClose();
    }, QUICK_VIEW_EXIT_MS + 20);
  }, [deckTy, onClose]);

  /*
   * GESTURE SYSTEM — one vertical pan, four entry points:
   *
   *   1. CAPTURE around the pager (ancestor of the FlatList)  → wins the
   *      gesture BEFORE the horizontal pager can swallow it. Collapsed:
   *      any vertical intent. Expanded: only a top-of-content pull-down.
   *   2. handle + header   → deck follows the finger (both states)
   *   3. expanded content  → ScrollView scrolls; at scroll top a downward
   *                          pull transfers to the deck via (1).
   *
   * Horizontal intent is always refused here so the pager owns left/right.
   */
  const dragStart = useRef(0);

  const isVerticalIntent = (gesture: PanResponderGestureState, min: number) =>
    Math.abs(gesture.dy) > min && Math.abs(gesture.dy) > Math.abs(gesture.dx);

  const panResponder = useRef(
    PanResponder.create({
      // Never claim on touch start: taps on content must stay taps.
      onStartShouldSetPanResponderCapture: () => false,
      onStartShouldSetPanResponder: () => false,

      /*
       * CAPTURE PHASE — attached to the wrapper AROUND the FlatList so
       * vertical intent beats the horizontal pager's own responder.
       */
      onMoveShouldSetPanResponderCapture: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => {
        if (!isVerticalIntent(gesture, 6)) return false;
        if (expandedRef.current) {
          return activeScrollYRef.current <= 0.5 && gesture.dy > 0;
        }
        return true;
      },

      /*
       * BUBBLE PHASE (handle + header): deck control in both states.
       * While expanded this only fires for touches on the handle/header —
       * content scrolls normally below them.
       */
      onMoveShouldSetPanResponder: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState,
      ) => !expandedRef.current && isVerticalIntent(gesture, 8),

      onPanResponderGrant: () => {
        dragStart.current = deckTy.value;
      },

      // Finger movement = deck movement. Direct, no easing while dragging.
      onPanResponderMove: (_event, gesture) => {
        const next = dragStart.current + gesture.dy;
        if (next < DECK_EXPANDED) {
          // Soft rubber-band above the expanded snap.
          deckTy.value = DECK_EXPANDED + (next - DECK_EXPANDED) * 0.15;
        } else {
          deckTy.value = Math.min(next, DECK_OFFSCREEN);
        }
      },

      /*
       * RELEASE — destination from velocity + displacement + direction:
       *
       *   dragged past collapse + buffer, or flick down → dismiss
       *   from expanded:  strong/small downward → collapse; upward → expand
       *   from collapsed: strong up / past halfway up → expand
       *                   otherwise → nearest snap
       */
      onPanResponderRelease: (_event, gesture) => {
        const current = dragStart.current + gesture.dy;
        const flickDown = gesture.vy > QUICK_VIEW_FLICK_VELOCITY;
        const flickUp = gesture.vy < -QUICK_VIEW_FLICK_VELOCITY;
        const collapsedTy = DECK_EXPANDED + DECK_SHIFT;

        if (current > collapsedTy) {
          if (
            current > collapsedTy + QUICK_VIEW_DISMISS_BUFFER ||
            flickDown
          ) {
            handleClose();
          } else {
            collapse();
          }
          return;
        }

        if (expandedRef.current) {
          if (flickDown || current > DECK_SHIFT / 2) {
            collapse();
          } else {
            snapDeckTo(DECK_EXPANDED);
          }
          return;
        }

        if (flickDown) {
          if (current > DECK_SHIFT / 2 + QUICK_VIEW_DISMISS_BUFFER) {
            handleClose();
          } else {
            collapse();
          }
          return;
        }
        if (flickUp) {
          expand();
          return;
        }
        if (current < DECK_SHIFT / 2) {
          expand();
        } else {
          collapse();
        }
      },

      onPanResponderTerminate: () => {
        // Gesture stolen mid-drag: settle to the nearest snap, never hang.
        if (deckTy.value < DECK_SHIFT / 2) {
          expand();
        } else {
          collapse();
        }
      },
    }),
  ).current;

  const panHandlers = panResponder.panHandlers;

  /* Backdrop rides the deck's own position: one shared value drives both,
     so entry and exit dim/un-dim together with the surface. */
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      deckTy.value,
      [DECK_EXPANDED + DECK_SHIFT, DECK_OFFSCREEN],
      [0.78, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const deckStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: deckTy.value }],
  }));

  /* Footer counter-translate: pinned to the device bottom while deckTy
     goes 0 → SHIFT; saturates past SHIFT so dismissal takes it away. */
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(deckTy.value, DECK_SHIFT) }],
  }));

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 70,
  }).current;

  const onViewableItemsChanged = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: ViewToken[];
    }) => {
      const item = viewableItems.find(
        (candidate) => candidate.isViewable,
      );
      if (item?.index != null) {
        setActiveIndex(item.index);
      }
    },
  ).current;

  const activeProduct = slides[activeIndex] ?? null;

  const handleSearch = () => {
    onClose();
    router.push('/search');
  };

  const handleShare = () => {
    if (!activeProduct) return;
    void Share.share({
      message: `${activeProduct.title} — Sakya Farms`,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {/* DIM LAYER — a SIBLING of the deck (never its parent). Parent
          opacity would dim the deck subtree too; siblings keep the page
          dimmed and the deck fully opaque. Opacity is tied to the deck's
          translate so they enter/leave together. */}
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
      {/* Tap-to-close catcher — above the backdrop, below the deck. */}
      <Pressable
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        onPress={handleClose}
        accessibilityLabel="Close product browser"
      />

        {/* THE PRODUCT DECK — ONE bottom-anchored surface. Its bottom edge
            is always the device bottom: no gap is geometrically possible. */}
        <Animated.View
          testID="deck-surface"
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: QUICK_VIEW_EXPANDED_HEIGHT,
              borderTopLeftRadius: QUICK_VIEW_BORDER_RADIUS,
              borderTopRightRadius: QUICK_VIEW_BORDER_RADIUS,
              overflow: 'hidden',
              backgroundColor: BG,
            },
            deckStyle,
          ]}
        >
          {/* DRAG HANDLE */}
          <View
            {...panHandlers}
            style={{
              height: QUICK_VIEW_HANDLE_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: BG,
            }}
          >
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: '#D6D3C8' }} />
          </View>

          {/* PRODUCT HEADER — close / context name + position counter / actions */}
          <View
            {...panHandlers}
            style={{
              height: QUICK_VIEW_HEADER_HEIGHT,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              backgroundColor: BG,
            }}
          >
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close product browser"
              style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#FFFFFF' }}
            >
              <Ionicons name="chevron-down" size={22} color={TEXT} />
            </Pressable>

            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
              <Text style={{ color: TEXT, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>
                {categoryName ?? 'Sakya Farms'}
              </Text>
              <Text testID="deck-counter" style={{ color: MUTED, fontSize: 10.5, marginTop: 1 }}>
                {slides.length === 0
                  ? 'No products'
                  : `${activeIndex + 1} / ${slides.length}`}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={handleSearch}
                accessibilityRole="button"
                accessibilityLabel="Search products"
                style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#FFFFFF' }}
              >
                <Ionicons name="search-outline" size={20} color={TEXT} />
              </Pressable>

              <Pressable
                onPress={handleShare}
                accessibilityRole="button"
                accessibilityLabel="Share product"
                style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#FFFFFF' }}
              >
                <Ionicons name="share-outline" size={19} color={TEXT} />
              </Pressable>
            </View>
          </View>

          {/* HORIZONTAL PRODUCT PAGING — one swipe = one product. The
              capture-phase pan on this wrapper takes vertical intent
              BEFORE the pager sees it; horizontal intent is refused, so
              the two gesture systems cannot cross-trigger.
              overflow:'hidden' is required: it zeroes the flex item's
              implicit min-height so the FlatList (and the slide
              ScrollViews inside it) stay BOUNDED to the deck instead of
              growing to their content height — that bound is what makes
              the expanded content scrollable at all. */}
          <View
            style={{ flex: 1, overflow: 'hidden' }}
            onLayout={(event) => {
              const next = event.nativeEvent.layout.height;
              setPagerHeight((previous) =>
                Math.abs(previous - next) > 1 ? next : previous,
              );
            }}
            {...panHandlers}
          >
            <FlatList
              ref={listRef}
              data={slides}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              bounces={false}
              decelerationRate="fast"
              style={{ flex: 1 }}
              initialScrollIndex={initialIndex}
              viewabilityConfig={viewabilityConfig}
              onViewableItemsChanged={onViewableItemsChanged}
              getItemLayout={(_, index) => ({
                length: SCREEN_WIDTH,
                offset: SCREEN_WIDTH * index,
                index,
              })}
              keyExtractor={(item) => item.id ?? item.slug}                renderItem={({ item, index }) => (
                  /* EXPLICIT pixel height (measured via onLayout) — the
                     VirtualizedList's cell renderer sizes to content, so
                     only absolute pixels bound the slide; that bound is
                     what makes the expanded ScrollView scrollable. */
                  <View
                    style={{
                      width: SCREEN_WIDTH,
                      height: pagerHeight > 0 ? pagerHeight : undefined,
                      overflow: 'hidden',
                    }}
                  >
                    <ProductSlide
                      product={item}
                      isActive={index === activeIndex}
                      expanded={expanded}
                      slideHeight={pagerHeight}
                      selectedVariantId={variantSelections[item.slug] ?? null}
                      onSelectVariant={selectVariant}
                      relatedProducts={relatedProducts}
                      onOpenProduct={onOpenProduct}
                      onExpand={expand}
                      activeScrollYRef={activeScrollYRef}
                    />
                  </View>
                )}
            />
          </View>

          {/* FIXED ADD-TO-CART BAR — inside the container, absolutely at
              its bottom, counter-translated so it stays pinned to the
              device bottom in BOTH states and leaves WITH the deck on
              dismissal. Never scrolls, never re-mounts on product switch. */}
          <Animated.View testID="deck-footer" style={footerStyle}>
            <SlideFooter
              activeProduct={activeProduct}
              selectedVariantId={
                activeProduct ? variantSelections[activeProduct.slug] ?? null : null
              }
              onSelectVariant={selectVariant}
            />
          </Animated.View>
        </Animated.View>
    </Modal>
  );
}

/* ============================================================
   PRODUCT QUICK VIEW — adapter kept for the screens that open
   the deck from a tapped product.
============================================================ */

export interface ProductQuickViewProps {
  slug: string | null;
  onClose: () => void;
  /** The surface's product list — this IS the swipe deck. */
  pagerProducts: ProductListItem[];
  /** Cross-sell items for the similar-products rail. */
  relatedProducts: ProductListItem[];
  onOpenProduct: (slug: string) => void;
}

export function ProductQuickView({
  slug,
  onClose,
  pagerProducts,
  relatedProducts,
  onOpenProduct,
}: ProductQuickViewProps) {
  return (
    <CategoryProductPager
      visible={slug != null}
      products={pagerProducts}
      initialProductSlug={slug}
      onClose={onClose}
      relatedProducts={relatedProducts}
      onOpenProduct={onOpenProduct}
    />
  );
}

/* ============================================================
   FIXED FOOTER — Add-to-Cart bar for the ACTIVE slide. Rendered
   once (outside the pager) so it never scrolls and never re-
   mounts when products switch.
============================================================ */

function SlideFooter({
  activeProduct,
  selectedVariantId,
  onSelectVariant,
}: {
  activeProduct: ProductListItem | null;
  selectedVariantId: string | null;
  onSelectVariant: (slug: string, variantId: string | null) => void;
}) {
  const insets = useSafeAreaInsets();

  const detail = useQuery({
    queryKey: ['catalog', 'product', activeProduct?.slug ?? 'none'],
    queryFn: () => catalogApi.getProduct(activeProduct!.slug),
    enabled: activeProduct != null,
    staleTime: 120_000,
  });

  const product = detail.data ?? null;

  const footerBox = {
    minHeight: QUICK_VIEW_CTA_MIN_HEIGHT,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: QUICK_VIEW_HORIZONTAL_PADDING,
    paddingTop: 12,
    paddingBottom: Math.max(insets.bottom, 12),
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: '#FFFFFF',
  };

  if (product == null) {
    // Slide loading / failed: keep the bar mounted with a neutral body so
    // the footer height (and the geometry) never changes.
    return (
      <View
        testID="deck-cta"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          ...footerBox,
        }}
      >
        <Text style={{ color: MUTED, fontSize: 12 }}>
          {detail.isPending ? 'Loading…' : 'Currently unavailable'}
        </Text>
      </View>
    );
  }

  return <SlideFooterContent
    product={product}
    selectedVariantId={selectedVariantId}
    onSelectVariant={onSelectVariant}
  />;
}

function SlideFooterContent({
  product,
  selectedVariantId,
  onSelectVariant,
}: {
  product: ProductDetail;
  selectedVariantId: string | null;
  onSelectVariant: (slug: string, variantId: string | null) => void;
}) {
  const insets = useSafeAreaInsets();

  const variants =
    product.variants?.filter(
      (variant) => variant.isAvailable,
    ) ?? [];

  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null;

  const { add, addVariant, resolving } = useProductAdd(product);

  const [pickerPick, setPickerPick] = useState<VariantPickerState | null>(null);

  const handleAdd = () => {
    if (!product.isAvailable || !selectedVariant) return;
    if (variants.length > 1 && !selectedVariantId) {
      // No explicit chip choice yet: ask explicitly, never blind-add.
      setPickerPick({ product });
      return;
    }
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
    <>
      <View
        testID="deck-cta"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          minHeight: QUICK_VIEW_CTA_MIN_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: QUICK_VIEW_HORIZONTAL_PADDING,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 12),
          borderTopWidth: 1,
          borderTopColor: BORDER,
          backgroundColor: '#FFFFFF',
        }}
      >
        <View style={{ flex: 1, paddingRight: 10 }}>
          {selectedVariant ? (
            <>
              <Text style={{ color: TEXT, fontSize: 11 }}>{selectedVariant.title}</Text>
              <Text style={{ color: TEXT, fontSize: 17, fontWeight: '800', marginTop: 2 }}>
                {formatMoney(selectedVariant.priceInPaise)}
              </Text>
            </>
          ) : (
            <Text style={{ color: MUTED, fontSize: 12 }}>Currently unavailable</Text>
          )}
        </View>

        <Pressable
          testID="deck-add"
          disabled={!selectedVariant || resolving || !product.isAvailable}
          onPress={handleAdd}
          accessibilityRole="button"
          accessibilityLabel="Add to cart"
          style={{
            height: 38,
            minWidth: 148,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            paddingHorizontal: 24,
            backgroundColor: !selectedVariant || resolving || !product.isAvailable ? '#B9BDB4' : '#238A19',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800' }}>
            {resolving ? 'Adding…' : 'Add to cart'}
          </Text>
        </Pressable>
      </View>

      <VariantPickerSheet
        pick={pickerPick}
        onClose={() => setPickerPick(null)}
        onAdded={(variant) => onSelectVariant(product.slug, variant.id)}
      />
    </>
  );
}

/* ============================================================
   ONE PRODUCT SLIDE
============================================================ */

function ProductSlide({
  product,
  isActive,
  expanded,
  slideHeight,
  selectedVariantId,
  onSelectVariant,
  relatedProducts,
  onOpenProduct,
  onExpand,
  activeScrollYRef,
}: {
  product: ProductListItem;
  isActive: boolean;
  expanded: boolean;
  slideHeight: number;
  selectedVariantId: string | null;
  onSelectVariant: (slug: string, variantId: string | null) => void;
  relatedProducts?: ProductListItem[];
  onOpenProduct?: (slug: string) => void;
  onExpand: () => void;
  activeScrollYRef: { current: number };
}) {
  const detail = useQuery({
    queryKey: [
      'catalog',
      'product',
      product.slug,
    ],
    queryFn: () =>
      catalogApi.getProduct(product.slug),
    enabled: isActive,
    staleTime: 120_000,
  });

  if (detail.isPending) {
    return (
      <View style={{ flex: 1, height: slideHeight > 0 ? slideHeight : undefined, padding: 12 }}>
        <View style={{ height: QUICK_VIEW_HERO_HEIGHT, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.08)' }} />
        <View style={{ marginTop: 14, height: 20, width: '75%', borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.08)' }} />
        <View style={{ marginTop: 8, height: 14, width: '33%', borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.08)' }} />
      </View>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Ionicons name="leaf-outline" size={38} color={BRAND} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: TEXT }}>Could not load product</Text>
        <Pressable
          onPress={() => detail.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={{ borderRadius: 10, borderWidth: 1, borderColor: BRAND, backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingVertical: 8 }}
        >
          <Text style={{ fontSize: 13, fontWeight: '800', color: BRAND }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ProductSlideContent
      product={detail.data}
      isActive={isActive}
      expanded={expanded}
      slideHeight={slideHeight}
      selectedVariantId={selectedVariantId}
      onSelectVariant={onSelectVariant}
      relatedProducts={relatedProducts}
      onOpenProduct={onOpenProduct}
      onExpand={onExpand}
      activeScrollYRef={activeScrollYRef}
    />
  );
}

/* ============================================================
   PRODUCT UI

   COLLAPSED — quick view: hero, name, variant, price. The deck
   pans (expand / dismiss); the footer stays pinned.

   EXPANDED — the same content becomes a vertical scroll of full
   details. At the scroll top, a downward pull transfers to the
   deck (capture-phase gesture) and collapses it with the finger.

   The Add-to-Cart bar is FIXED to the deck bottom in BOTH states
   and lives outside the pager entirely (see SlideFooter).
============================================================ */

function ProductSlideContent({
  product,
  isActive,
  expanded,
  slideHeight,
  selectedVariantId,
  onSelectVariant,
  relatedProducts,
  onOpenProduct,
  onExpand,
  activeScrollYRef,
}: {
  product: ProductDetail;
  isActive: boolean;
  expanded: boolean;
  slideHeight: number;
  selectedVariantId: string | null;
  onSelectVariant: (slug: string, variantId: string | null) => void;
  relatedProducts?: ProductListItem[];
  onOpenProduct?: (slug: string) => void;
  onExpand: () => void;
  activeScrollYRef: { current: number };
}) {
  const insets = useSafeAreaInsets();

  const variants =
    product.variants?.filter(
      (variant) => variant.isAvailable,
    ) ?? [];

  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null;

  const similar =
    (relatedProducts ?? [])
      .filter((item) => item.slug !== product.slug)
      .slice(0, 3);

  const scrollRef = useRef<ScrollView>(null);

  // Product switching opens each product at the top (and keeps the
  // pull-down transfer's scrollY mirror truthful).
  useEffect(() => {
    if (!isActive) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    activeScrollYRef.current = 0;
  }, [isActive, activeScrollYRef]);

  // Clearance the scroll content must keep for the FIXED footer.
  const ctaClearance =
    QUICK_VIEW_CTA_MIN_HEIGHT + Math.max(insets.bottom, 12) + 16;

  const info = (
    <>
      {/* PRODUCT NAME + VARIANT + PRICE — hierarchy per spec:
          image → name → variant → price. */}
      <View style={{ paddingHorizontal: QUICK_VIEW_HORIZONTAL_PADDING, paddingTop: 12 }}>
        <Text testID="deck-title" style={{ color: TEXT, fontSize: 19, fontWeight: '800', lineHeight: 25 }}>
          {product.title}
        </Text>

        {selectedVariant ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
            <Text style={{ color: TEXT, fontSize: 13, fontWeight: '600' }}>
              {selectedVariant.title}
            </Text>
            <Text style={{ color: TEXT, fontSize: 16, fontWeight: '800' }}>
              {formatMoney(selectedVariant.priceInPaise)}
            </Text>
            {selectedVariant.compareAtPriceInPaise != null &&
            selectedVariant.compareAtPriceInPaise > selectedVariant.priceInPaise ? (
              <Text style={{ color: MUTED, fontSize: 12.5, textDecorationLine: 'line-through' }}>
                {formatMoney(selectedVariant.compareAtPriceInPaise)}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={{ color: MUTED, fontSize: 13, marginTop: 6 }}>
            Currently unavailable
          </Text>
        )}
      </View>

      {/* EXPANDED-ONLY SECTIONS — variant chips, vendor, view-details,
          similar rail. Only data the backend actually returns. */}
      {expanded ? (
        <>
          {/* VARIANT SELECTOR — backend titles verbatim; never inferred units. */}
          {variants.length > 1 ? (
            <View style={{ paddingHorizontal: QUICK_VIEW_HORIZONTAL_PADDING, marginTop: 10 }}>
              <Text style={{ color: MUTED, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>
                SELECT PACK
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {variants.map((variant) => {
                  const active = variant.id === selectedVariant?.id;
                  return (
                    <Pressable
                      key={variant.id}
                      onPress={() => onSelectVariant(product.slug, variant.id)}
                      accessibilityRole="radio"
                      accessibilityLabel={`Select ${variant.title}`}
                      accessibilityState={{ selected: active }}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: active ? BRAND : BORDER,
                        backgroundColor: active ? '#EEF7ED' : '#FFFFFF',
                      }}
                    >
                      <Text
                        style={{ fontSize: 12.5, fontWeight: active ? '800' : '600', color: active ? BRAND : TEXT }}
                      >
                        {variant.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={{ marginHorizontal: 12, marginTop: 12, minHeight: 64, flexDirection: 'row', alignItems: 'center', borderRadius: 15, backgroundColor: '#FFFFFF', paddingHorizontal: 14 }}>
            <View style={{ height: 42, width: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#EEF7ED' }}>
              <Ionicons name="leaf" size={22} color={BRAND} />
            </View>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={{ color: TEXT, fontSize: 14, fontWeight: '800' }}>Sakya Farms</Text>
              <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>
                {product.vendor ?? 'Farm to home'}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => onOpenProduct?.(product.slug)}
            accessibilityRole="button"
            accessibilityLabel="Open the full product page"
            style={{ marginHorizontal: 12, marginTop: 8, minHeight: 54, flexDirection: 'row', alignItems: 'center', borderRadius: 15, backgroundColor: '#FFFFFF', paddingHorizontal: 12 }}
          >
            <View style={{ height: 38, width: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#F4F4F1' }}>
              <Ionicons name="cube-outline" size={21} color={TEXT} />
            </View>
            <Text style={{ marginLeft: 10, flex: 1, color: TEXT, fontSize: 13, fontWeight: '700' }}>
              View full product page
            </Text>
            <Ionicons name="chevron-forward" size={20} color={MUTED} />
          </Pressable>

          {similar.length > 0 ? (
            <View style={{ marginTop: 14, paddingHorizontal: 12 }}>
              <Text style={{ color: TEXT, fontSize: 16, fontWeight: '800', marginBottom: 10 }}>
                Similar products
              </Text>
              <View style={{ flexDirection: 'row', gap: 9 }}>
                {similar.map((item) => (
                  <SimilarProduct
                    key={item.id}
                    item={item}
                    onPress={() =>
                      onOpenProduct?.(item.slug)
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    /* EXPLICIT measured height — see the pager wrapper comment. With a
       definite height, the ScrollView below gets a definite flex container
       and actually overflows → scrolls. */
    <View
      style={
        slideHeight > 0
          ? { height: slideHeight, backgroundColor: BG }
          : { flex: 1, overflow: 'hidden', backgroundColor: BG }
      }
    >
      {expanded ? (
        // EXPANDED — scrollable details. The capture-phase pan on the
        // pager wrapper transfers a top-of-content downward pull to the deck.
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: ctaClearance }}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          // iOS bounce at the top would fight the capture-phase gesture
          // transfer (the deck must own the first downward pull), so the
          // content view never rubber-bands vertically.
          bounces={false}
          scrollEventThrottle={16}
          onScroll={(event) => {
            activeScrollYRef.current = event.nativeEvent.contentOffset.y;
          }}
        >
          <HeroImage product={product} height={QUICK_VIEW_HERO_HEIGHT} />
          {info}
        </ScrollView>
      ) : (
        // COLLAPSED — static column: hero + name + variant + price.
        // The pan lives on the pager wrapper (ancestor), so no handler
        // is needed here; taps stay taps.
        <View style={{ flex: 1 }}>
          <HeroImage product={product} height={QUICK_VIEW_HERO_HEIGHT} />
          {info}
        </View>
      )}

      {/* Collapsed affordance: tapping the hero also expands. */}
      {!expanded ? (
        <Pressable
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityLabel="Expand product details"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: QUICK_VIEW_HERO_HEIGHT }}
        />
      ) : null}
    </View>
  );
}

function HeroImage({ product, height }: { product: ProductDetail; height: number }) {
  if (!product.primaryImageUrl) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFEFEA' }}>
        <Ionicons name="leaf-outline" size={44} color={MUTED} />
      </View>
    );
  }

  return (
    <View testID="deck-hero" style={{ height, width: '100%', backgroundColor: '#F7F7FF' }}>
      <Image
        source={{ uri: product.primaryImageUrl }}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
        cachePolicy="disk"
        transition={150}
      />
    </View>
  );
}

/* ============================================================
   SIMILAR PRODUCT — real catalog item, tap opens its page, with
   a one-tap ADD of the default variant.
============================================================ */

function SimilarProduct({
  item,
  onPress,
}: {
  item: ProductListItem;
  onPress: () => void;
}) {
  const { add, resolving } = useProductAdd(item);

  const hasDiscount =
    item.compareAtMaxInPaise != null &&
    item.price?.minInPaise != null &&
    item.compareAtMaxInPaise > item.price.minInPaise;

  const discountPercent = hasDiscount
    ? Math.round(
        (1 -
          item.price!.minInPaise / item.compareAtMaxInPaise!) *
          100,
      )
    : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`View ${item.title}`}
      style={{ flex: 1, borderRadius: 16, backgroundColor: '#FFFFFF', padding: 8 }}
    >
      <View
        style={{
          position: 'relative',
          aspectRatio: 1,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 10,
          backgroundColor: '#F5F5F7',
        }}
      >
        {item.primaryImageUrl ? (
          <Image
            source={{ uri: item.primaryImageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            cachePolicy="disk"
            recyclingKey={item.primaryImageUrl}
            transition={150}
          />
        ) : (
          <Ionicons name="leaf-outline" size={25} color={MUTED} />
        )}

        {item.isAvailable ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              void add();
            }}
            disabled={resolving}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.title} to cart`}
            style={{
              position: 'absolute',
              bottom: -10,
              right: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: BRAND,
              backgroundColor: '#FFFFFF',
              paddingHorizontal: 12,
              paddingVertical: 3,
              opacity: resolving ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: '800', color: BRAND }}>ADD</Text>
          </Pressable>
        ) : null}
      </View>

      <Text
        style={{ marginTop: 10, color: TEXT, fontSize: 11, fontWeight: '600', lineHeight: 14 }}
        numberOfLines={2}
      >
        {item.title}
      </Text>

      {item.price?.minInPaise != null ? (
        <View style={{ marginTop: 3, flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text style={{ color: TEXT, fontSize: 12, fontWeight: '800' }}>
            {formatMoney(item.price.minInPaise)}
          </Text>

          {hasDiscount ? (
            <Text style={{ color: MUTED, fontSize: 10, textDecorationLine: 'line-through' }}>
              {formatMoney(item.compareAtMaxInPaise!)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {discountPercent != null && discountPercent > 0 ? (
        <Text style={{ color: '#38883E', fontSize: 10, fontWeight: '700' }}>
          {discountPercent}% OFF
        </Text>
      ) : null}
    </Pressable>
  );
}
