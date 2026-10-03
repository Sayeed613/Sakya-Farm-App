import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Head from 'expo-router/head';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  Share,
  Text as RNText,
  View,
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
import { journeyApi } from '../../../src/api/journey';
import { useAuthStore } from '../../../src/stores/auth-store';
import { ErrorState } from '../../../src/components/ErrorState';
import { SkeletonBlock } from '../../../src/components/LoadingSkeleton';
import { ProductDetailsSheet } from '../../../src/components/commerce/ProductDetailsSheet';
import { ProductVariantSelector } from '../../../src/components/commerce/ProductVariantSelector';
import { RelatedProductCard } from '../../../src/components/commerce/RelatedProductCard';
import { ReviewsSection } from '../../../src/components/commerce/ReviewsSection';
import { ProductMediaCard } from '../../../src/components/commerce/ProductMediaCard';
import { QuantityStepper } from '../../../src/components/commerce/QuantityStepper';
import { useDetailCartControls } from '../../../src/lib/use-detail-cart-controls';
import { formatMoney } from '../../../src/lib/format';
import { goBackOrHome } from '../../../src/lib/navigation';
import { cardShadow } from '../../../src/lib/shadows';
import { deriveBadges } from '../../../src/lib/product-badges';
import {
  defaultVariantOfDetail,
} from '../../../src/lib/use-product-add';
import { variantSelectorLabelOf } from '../../../src/lib/variant-units';
import type { ProductDetail, ProductListItem, WishlistResponse } from '@sakya/types';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const CANVAS = '#FAF7F0';

const HEADER_ROW_HEIGHT = 56;

const CART_BAR_HEIGHT = 92;

/** Page gutter — cards breathe inside this. */
const GUTTER = 16;

export default function ProductDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );

  const [sheetOpen, setSheetOpen] = useState(false);

  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  /*
   * Header fade-in. The white header surface and its title appear as the
   * media card scrolls beneath it — replaces the old morphing hero.
   */
  const HEADER_FADE_RANGE: [number, number] = [120, 220];

  const headerBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      HEADER_FADE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const headerTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      HEADER_FADE_RANGE,
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  /*
   * Product request.
   */
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

  /*
   * Cart controls — auth-aware and REACTIVE.
   *
   * The previous implementation wrote to the guest store unconditionally
   * (signed-in customers' adds never reached the server cart) and read the
   * quantity via useGuestCartStore.getState() during render (never
   * re-rendered, so the stepper never replaced the ADD button). The
   * useDetailCartControls hook fixes both: server cart when signed in,
   * guest store otherwise, and quantity from subscribed state.
   */
  const { quantity: selectedQuantity, add: onAddPress, increment: stepperIncrement, decrement: stepperDecrement } =
    useDetailCartControls(detailData, selected?.id ?? null);

  /*
   * Related products.
   */
  const relatedProducts = useMemo<ProductListItem[]>(() => {
    const cached =
      queryClient.getQueryData<{
        items: ProductListItem[];
      }>([
        'catalog',
        'products',
        'home-all',
      ]);

    return (cached?.items ?? [])
      .filter((item) => item.slug !== slug)
      .slice(0, 10);
  }, [queryClient, slug]);

  const handleShare = useCallback(() => {
    if (!detailData) return;

    void Share.share({
      message: `${detailData.title} — Sakya Farms`,
    });
  }, [detailData]);

  /*
   * Wishlist: the heart reflects the SERVER wishlist (['wishlist'] cache).
   * Toggling calls the API optimistically; the server response replaces the
   * cache so every surface reading it stays in sync. Failures roll back and
   * surface as a brief note.
   */
  const queryClientForWishlist = useQueryClient();
  const session = useAuthStore((state) => state.session);
  const wishlistQuery = useQuery({
    queryKey: ['wishlist'],
    queryFn: journeyApi.listWishlist,
    enabled: session !== null,
    staleTime: 30_000,
  });
  const isWishlisted =
    session !== null && detailData
      ? (wishlistQuery.data?.items.some((item) => item.productSlug === detailData.slug) ?? false)
      : false;

  const [wishlistError, setWishlistError] = useState(false);

  const toggleWishlist = useCallback(async () => {
    if (!detailData || session === null) return;
    setWishlistError(false);
    const slug = detailData.slug;
    // Optimistic flip for an instant heart.
    const previous = queryClientForWishlist.getQueryData<WishlistResponse>(['wishlist']);
    if (previous !== undefined) {
      queryClientForWishlist.setQueryData<WishlistResponse>(['wishlist'], {
        items: previous.items.some((item) => item.productSlug === slug)
          ? previous.items.filter((item) => item.productSlug !== slug)
          : [
              {
                id: `optimistic-${slug}`,
                productSlug: slug,
                productTitle: detailData.title,
                imageUrl: detailData.primaryImageUrl,
                priceInPaise: null,
                compareAtPriceInPaise: null,
                isAvailable: true,
                defaultVariantId: null,
                addedAt: new Date().toISOString(),
              },
              ...previous.items,
            ],
      });
    }
    try {
      await journeyApi.addWishlistItem(slug);
    } catch {
      try {
        // Adding may fail because it is ALREADY saved — then remove instead.
        await journeyApi.removeWishlistItem(slug);
      } catch {
        setWishlistError(true);
      }
      queryClientForWishlist.setQueryData(['wishlist'], previous);
    }
  }, [detailData, session, queryClientForWishlist]);

  /*
   * Product feature cards.
   *
   * Only use real information already available on ProductDetail.
   * No fake values are inserted.
   *
   * NOTE: this must stay with the other hooks, ABOVE the loading early
   * return — a hook after a conditional return changes the hook order
   * between renders and crashes with "Rendered more hooks".
   */
  const quickViewFeatures = useMemo(() => {
    const features: Array<{
      key: string;
      title: string;
      value: string;
      icon: keyof typeof Ionicons.glyphMap;
    }> = [];

    if (detailData) {
      if (
        detailData.productType &&
        detailData.productType.trim().length > 0
      ) {
        features.push({
          key: 'type',
          title: 'Type',
          value: detailData.productType,
          icon: 'restaurant-outline',
        });
      }

      const primaryCategory = detailData.categories?.[0];
      if (primaryCategory) {
        features.push({
          key: 'category',
          title: 'Category',
          value: primaryCategory.name,
          icon: 'grid-outline',
        });
      }

      if (detailData.tags?.length > 0 && detailData.tags[0]) {
        const firstUsefulTag =
          detailData.tags.find(
            (tag) =>
              tag.trim().length > 0 &&
              tag.toLowerCase() !==
                primaryCategory?.name.toLowerCase(),
          ) ?? detailData.tags[0];

        if (firstUsefulTag) {
          features.push({
            key: 'tag',
            title: 'Product',
            value: firstUsefulTag,
            icon: 'pricetag-outline',
          });
        }
      }
    }

    return features.slice(0, 3);
  }, [detailData]);

  /*
   * Loading / error.
   */
  if (detail.isPending || !detailData) {
    if (detail.isError) {
      return (
        <View
          className="flex-1"
          style={{
            backgroundColor: CANVAS,
            paddingTop: insets.top,
          }}
        >
          <ErrorState
            title="Could not load this product"
            message="We could not reach the product just now. Check your connection and try again."
            onRetry={() => void detail.refetch()}
          />
        </View>
      );
    }

    return (
      <View
        className="flex-1"
        style={{
          backgroundColor: CANVAS,
          paddingTop: insets.top,
        }}
      >
        <View className="gap-3 px-4 pt-4">
          <SkeletonBlock className="h-72 w-full rounded-2xl" />
          <SkeletonBlock className="h-5 w-2/3" />
          <SkeletonBlock className="h-4 w-1/3" />
          <SkeletonBlock className="h-10 w-full rounded-xl" />
        </View>
      </View>
    );
  }

  /*
   * Images.
   */
  /*
   * Image URLs, position-sorted. Feeds ProductMediaCard:
   * one URL renders the full uncropped photo; several render the
   * gap-spaced tile grid.
   */
  const imageUrls = detailData.images
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((image) => image.url)
    .filter((url): url is string => Boolean(url));

  const badges = deriveBadges(detailData);

  const selectorLabel =
    variantSelectorLabelOf(variants);

  /*
   * JSON-LD (structured data) for crawlers and answer engines.
   *
   * STRICT RULE: every field below is copied from the API response the page
   * already renders — no invented ratings, reviews, guarantees or prices.
   * `offers` are derived from the real variant rows (price, availability),
   * so the structured data always agrees with what a shopper sees.
   * Rendered only on web; native ignores <Head> children.
   */
  const productJsonLd = (() => {
    if (detailData === null || typeof window === 'undefined') return null;
    const siteUrl = window.location.origin;
    const canonical = `${siteUrl}/products/${encodeURIComponent(detailData.slug)}`;
    const price = detailData.price;
    const offerVariants = detailData.variants.filter(
      (variant) => variant.isAvailable && variant.priceInPaise > 0,
    );
    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: detailData.title,
      ...(detailData.description ? { description: detailData.description } : {}),
      ...(imageUrls.length > 0 ? { image: imageUrls } : {}),
      url: canonical,
      ...(detailData.vendor ? { brand: { '@type': 'Brand', name: detailData.vendor } } : {}),
      ...(offerVariants.length > 0 && price !== null
        ? {
            offers: {
              '@type': 'AggregateOffer',
              priceCurrency: price.currency,
              lowPrice: (price.minInPaise / 100).toFixed(2),
              highPrice: (price.maxInPaise / 100).toFixed(2),
              offerCount: offerVariants.length,
              availability: detailData.isAvailable
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
              url: canonical,
            },
          }
        : {}),
    };
  })();

  return (
    <View
      className="flex-1"
      style={{
        backgroundColor: CANVAS,
      }}
    >
      {/* Web document title + social/SEO meta for the product page — the
          title tracks the loaded product; the description is the real
          listing intro, not fabricated copy. */}
      <Head>
        <title>{detailData ? `${detailData.title} — Sakya Farms` : 'Product — Sakya Farms'}</title>
        {detailData ? (
          <meta
            name="description"
            content={
              detailData.description?.trim().slice(0, 160) ||
              `Buy ${detailData.title} from Sakya Farms. Farm-fresh, delivered.`
            }
          />
        ) : null}
        {detailData ? (
          <link
            rel="canonical"
            href={`${typeof window !== 'undefined' ? window.location.origin : 'https://sakya.farm'}/products/${encodeURIComponent(detailData.slug)}`}
          />
        ) : null}
        <meta property="og:title" content={detailData?.title ?? 'Sakya Farms'} />
        <meta property="og:type" content="product" />
        {detailData?.description ? (
          <meta property="og:description" content={detailData.description.slice(0, 200)} />
        ) : null}
        {detailData?.primaryImageUrl ? (
          <meta property="og:image" content={detailData.primaryImageUrl} />
        ) : null}
        {productJsonLd !== null ? (
          <script
            type="application/ld+json"
            // JSON is stringified with every `<` escaped so product text can
            // never terminate the script element (HTML-injection-safe JSON-LD).
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(productJsonLd).replace(/</g, '\\u003c'),
            }}
          />
        ) : null}
      </Head>
      {/* ============================================================
          SCROLLING PRODUCT CONTENT
          ============================================================ */}

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom:
            CART_BAR_HEIGHT +
            Math.max(insets.bottom, 12) +
            18,
        }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ========================================================
            MEDIA CARD
            Single image -> full uncropped photo. Multiple images ->
            gap-spaced rounded tile grid, inside one white shadowed card.
            ======================================================== */}

        <View
          style={{
            paddingHorizontal: GUTTER,
            paddingTop:
              insets.top +
              HEADER_ROW_HEIGHT +
              8,
          }}
        >
          <ProductMediaCard
            urls={imageUrls}
            accessibilityLabel={`${detailData.title} photos`}
            onPress={() => setSheetOpen(true)}
          />
        </View>

        {wishlistError ? (
          <RNText
            className="mt-2 text-center text-[12px] font-semibold"
            style={{ color: '#B3453E' }}
          >
            Could not sync your wishlist — check your connection and try again.
          </RNText>
        ) : null}


        {/* ========================================================
            MAIN PRODUCT CARD
            ======================================================== */}

        <View
          style={[
            {
              marginHorizontal: 16,
              marginTop: 10,
              paddingHorizontal: 22,
              paddingTop: 18,
              paddingBottom: 20,
              borderRadius: 24,
              backgroundColor: '#FFFFFF',
            },
            cardShadow,
          ]}
        >
          {/* Delivery + rating */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Ionicons
                name="time-outline"
                size={17}
                color={MUTED}
              />

              <RNText
                style={{
                  color: INK,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {detailData.isAvailable
                  ? 'Available'
                  : 'Unavailable'}
              </RNText>
            </View>

            <View
              style={{
                flex: 1,
                alignItems: 'flex-end',
              }}
            >
              {detailData.isAvailable ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={BRAND}
                  />

                  <RNText
                    style={{
                      color: BRAND,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    In stock
                  </RNText>
                </View>
              ) : null}
            </View>
          </View>

          {/* Product title */}
          <RNText
            style={{
              color: INK,
              fontSize: 22,
              lineHeight: 28,
              fontWeight: '800',
            }}
          >
            {detailData.title}
          </RNText>

          {/* Selected variant */}
          {selected ? (
            <RNText
              style={{
                marginTop: 5,
                color: MUTED,
                fontSize: 13,
              }}
            >
              {selected.title}
            </RNText>
          ) : null}

          {/* Price */}
          {selected ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 8,
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <RNText
                style={{
                  color: INK,
                  fontSize: 21,
                  fontWeight: '800',
                }}
              >
                {formatMoney(
                  selected.priceInPaise,
                )}
              </RNText>

              {selected.compareAtPriceInPaise != null &&
              selected.compareAtPriceInPaise >
                selected.priceInPaise ? (
                <>
                  <RNText
                    style={{
                      color: MUTED,
                      fontSize: 12,
                    }}
                  >
                    MRP
                  </RNText>

                  <RNText
                    style={{
                      color: MUTED,
                      fontSize: 13,
                      textDecorationLine:
                        'line-through',
                    }}
                  >
                    {formatMoney(
                      selected.compareAtPriceInPaise,
                    )}
                  </RNText>
                </>
              ) : null}

              {badges.discountPercent != null ? (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 999,
                    backgroundColor: '#EAF7E8',
                  }}
                >
                  <RNText
                    style={{
                      color: BRAND,
                      fontSize: 11,
                      fontWeight: '800',
                    }}
                  >
                    {badges.discountPercent}% OFF
                  </RNText>
                </View>
              ) : null}
            </View>
          ) : (
            <RNText
              style={{
                marginTop: 8,
                color: MUTED,
                fontSize: 14,
              }}
            >
              Currently unavailable
            </RNText>
          )}

          {/* Availability */}
          {detailData.isAvailable ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 14,
                gap: 6,
              }}
            >
              <Ionicons
                name="cube-outline"
                size={18}
                color={MUTED}
              />

              <RNText
                style={{
                  color: MUTED,
                  fontSize: 13,
                }}
              >
                Available
              </RNText>
            </View>
          ) : null}

          {/* Select unit */}
          {variants.length > 0 ? (
            <View
              style={{
                marginTop: 22,
              }}
            >
              <RNText
                style={{
                  color: INK,
                  fontSize: 17,
                  fontWeight: '700',
                  marginBottom: 10,
                }}
              >
                Select Unit
              </RNText>

              <ProductVariantSelector
                variants={variants}
                selected={selected}
                onSelect={(variant) =>
                  setSelectedVariantId(
                    variant.id,
                  )
                }
                showPrices
                size="large"
              />

              {selectorLabel ? (
                <RNText
                  style={{
                    marginTop: 6,
                    color: MUTED,
                    fontSize: 11,
                  }}
                >
                  Prices update with the selected{' '}
                  {selectorLabel
                    .replace(
                      'Select ',
                      '',
                    )
                    .toLowerCase()}
                </RNText>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* ========================================================
            FEATURE CARDS
            ======================================================== */}

        <View
          style={{
            marginTop: 10,
            paddingHorizontal: 16,
          }}
        >
          <FlatList
            horizontal
            data={quickViewFeatures}
            keyExtractor={(item) => item.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: 8,
              paddingRight: 8,
            }}
            renderItem={({ item }) => (
              <View
                style={{
                  width: 150,
                  minHeight: 88,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 14,
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: '#ECE8E0',
                  justifyContent: 'space-between',
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Ionicons
                    name={item.icon}
                    size={15}
                    color={MUTED}
                  />

                  <RNText
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      color: MUTED,
                      fontSize: 12.5,
                      fontWeight: '500',
                    }}
                  >
                    {item.title}
                  </RNText>
                </View>

                <RNText
                  numberOfLines={2}
                  style={{
                    color: INK,
                    fontSize: 15,
                    fontWeight: '700',
                    lineHeight: 19,
                  }}
                >
                  {item.value}
                </RNText>
              </View>
            )}
          />

          {/* View details card */}
          <Pressable
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open all product details"
            style={{
              marginTop: 8,
              height: 58,
              borderRadius: 14,
              backgroundColor: '#EFF9EC',
              borderWidth: 1,
              borderColor: '#9ED594',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 7,
            }}
          >
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={BRAND}
            />

            <RNText
              style={{
                color: BRAND,
                fontSize: 13,
                fontWeight: '800',
              }}
            >
              View details
            </RNText>
          </Pressable>
        </View>


        {/* ========================================================
            BRAND CARD
            ======================================================== */}

        {detailData.vendor ? (
          <Pressable
            accessibilityRole="button"
            style={[
              {
                marginHorizontal: 16,
                marginTop: 10,
                minHeight: 88,
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderRadius: 22,
                backgroundColor: '#FFFFFF',
                flexDirection: 'row',
                alignItems: 'center',
              },
              cardShadow,
            ]}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                backgroundColor: '#F5F5F2',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: '#ECE8E0',
              }}
            >
              <Ionicons
                name="storefront-outline"
                size={24}
                color={BRAND}
              />
            </View>

            <View
              style={{
                flex: 1,
                marginLeft: 13,
              }}
            >
              <RNText
                numberOfLines={1}
                style={{
                  color: INK,
                  fontSize: 17,
                  fontWeight: '800',
                }}
              >
                {String(detailData.vendor)}
              </RNText>

              <RNText
                style={{
                  marginTop: 3,
                  color: MUTED,
                  fontSize: 13,
                }}
              >
                Explore all products
              </RNText>
            </View>

            <Ionicons
              name="chevron-forward"
              size={21}
              color={MUTED}
            />
          </Pressable>
        ) : null}

        {/* ========================================================
            DELIVERY / SERVICE CARD
            ======================================================== */}

        <View
          style={[
            {
              marginHorizontal: 16,
              marginTop: 10,
              minHeight: 76,
              paddingHorizontal: 16,
              borderRadius: 22,
              backgroundColor: '#FFFFFF',
              flexDirection: 'row',
              alignItems: 'center',
            },
            cardShadow,
          ]}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 15,
              backgroundColor: '#F5F5F2',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="cube-outline"
              size={23}
              color={BRAND}
            />
          </View>

          <View
            style={{
              flex: 1,
              marginLeft: 12,
            }}
          >
            <RNText
              style={{
                color: INK,
                fontSize: 14,
                fontWeight: '700',
              }}
            >
              Delivery & service
            </RNText>

            <RNText
              style={{
                marginTop: 2,
                color: MUTED,
                fontSize: 12,
              }}
            >
              Available for this product
            </RNText>
          </View>

          <Ionicons
            name="chevron-forward"
            size={20}
            color={MUTED}
          />
        </View>

        {/* ========================================================
            VIEW DETAILS
            ======================================================== */}

        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open all product details"
          style={[
            {
              marginHorizontal: 16,
              marginTop: 10,
              minHeight: 54,
              paddingHorizontal: 16,
              borderRadius: 18,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: LINE,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
            cardShadow,
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
            }}
          >
            <Ionicons
              name="information-circle-outline"
              size={19}
              color={BRAND}
            />

            <RNText
              style={{
                color: INK,
                fontSize: 14,
                fontWeight: '700',
              }}
            >
              View all details
            </RNText>
          </View>

          <Ionicons
            name="chevron-forward"
            size={17}
            color={MUTED}
          />
        </Pressable>

        {/* ========================================================
            REVIEWS — published reviews + the eligible write form
            ======================================================== */}

        <View
          style={[
            {
              marginHorizontal: 16,
              marginTop: 14,
              paddingVertical: 18,
              paddingHorizontal: 22,
              backgroundColor: '#FFFFFF',
              borderRadius: 20,
              borderWidth: 1,
              borderColor: '#E4DED2',
            },
          ]}
        >
          <ReviewsSection productId={detailData.id} />
        </View>

        {/* ========================================================
            RELATED PRODUCTS
            ======================================================== */}

        {relatedProducts.length > 0 ? (
          <View
            style={{
              marginTop: 18,
            }}
          >
            <RNText
              style={{
                paddingHorizontal: 16,
                color: INK,
                fontSize: 17,
                fontWeight: '800',
                marginBottom: 9,
              }}
            >
              People also bought
            </RNText>

            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={relatedProducts}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{
                paddingHorizontal: 16,
                gap: 10,
              }}
              renderItem={({ item }) => (
                <RelatedProductCard
                  item={item}
                  onOpen={(nextSlug) =>
                    router.push(
                      `/(shop)/products/${nextSlug}`,
                    )
                  }
                />
              )}
            />
          </View>
        ) : null}
      </Animated.ScrollView>

      {/* ============================================================
          HEADER BACKGROUND
          ============================================================ */}

      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height:
              insets.top +
              HEADER_ROW_HEIGHT,
            backgroundColor: '#FFFFFF',
            borderBottomWidth: 1,
            borderBottomColor: LINE,
          },
          headerBgStyle,
        ]}
      />

      {/* ============================================================
          TOP CONTROLS
          ============================================================ */}

      <Animated.View
        pointerEvents="box-none"
        className="absolute left-0 right-0 top-0"
        style={{
          paddingTop: insets.top,
        }}
      >
        <View
          style={{
            height: HEADER_ROW_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 12,
          }}
        >
          {/* Back */}
          <CircleButton
            onPress={goBackOrHome}
            icon="chevron-back"
            label="Go back"
          />

          {/* Header title */}
          <Animated.View
            pointerEvents="none"
            style={[
              {
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                marginHorizontal: 10,
              },
              headerTitleStyle,
            ]}
          >

            <RNText
              numberOfLines={1}
              className="ml-2.5 flex-1 text-[13.5px] font-bold"
              style={{
                color: INK,
              }}
            >
              {detailData.title}
            </RNText>
          </Animated.View>

          {/* Wishlist — server-backed; a failed sync shows a note */}
          <CircleButton
            onPress={() => void toggleWishlist()}
            icon={isWishlisted ? 'heart' : 'heart-outline'}
            label={
              isWishlisted
                ? 'Remove from wishlist'
                : 'Add to wishlist'
            }
          />

          <View style={{ width: 8 }} />

          {/* Search */}
          <CircleButton
            onPress={() => router.push('/search')}
            icon="search-outline"
            label="Search"
          />

          <View style={{ width: 8 }} />

          {/* Share */}
          <CircleButton
            onPress={handleShare}
            icon="share-social-outline"
            label="Share this product"
          />
        </View>
      </Animated.View>

      {/* ============================================================
          STICKY ADD TO CART
          ============================================================ */}

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          minHeight: CART_BAR_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom:
            Math.max(insets.bottom, 10) +
            10,
          backgroundColor:
            'rgba(255,255,255,0.97)',
          borderTopWidth: 1,
          borderTopColor: '#E9E5DC',
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 18,
          shadowOffset: {
            width: 0,
            height: -5,
          },
          elevation: 12,
        }}
      >
        {/* Price */}
        <View
          style={{
            flex: 1,
            paddingRight: 12,
          }}
        >
          {selected ? (
            <>
              <RNText
                numberOfLines={1}
                style={{
                  color: INK,
                  fontSize: 13,
                  fontWeight: '700',
                }}
              >
                {selected.title}
              </RNText>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  gap: 6,
                  marginTop: 2,
                }}
              >
                <RNText
                  style={{
                    color: INK,
                    fontSize: 18,
                    fontWeight: '800',
                  }}
                >
                  {formatMoney(
                    selected.priceInPaise,
                  )}
                </RNText>

                {selected.compareAtPriceInPaise !=
                  null &&
                selected.compareAtPriceInPaise >
                  selected.priceInPaise ? (
                  <>
                    <RNText
                      style={{
                        color: MUTED,
                        fontSize: 11,
                      }}
                    >
                      MRP
                    </RNText>

                    <RNText
                      style={{
                        color: MUTED,
                        fontSize: 12,
                        textDecorationLine:
                          'line-through',
                      }}
                    >
                      {formatMoney(
                        selected.compareAtPriceInPaise,
                      )}
                    </RNText>
                  </>
                ) : null}
              </View>
            </>
          ) : (
            <RNText
              style={{
                color: MUTED,
                fontSize: 12,
              }}
            >
              Currently unavailable
            </RNText>
          )}

          <RNText
            style={{
              color: MUTED,
              fontSize: 10,
              marginTop: 2,
            }}
          >
            Inclusive of all taxes
          </RNText>
        </View>

        {/* Cart controls */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {selectedQuantity > 0 ? (
            <QuantityStepper
              quantity={selectedQuantity}
              disabled={false}
              onAdd={onAddPress}
              onIncrement={() => {
                void stepperIncrement();
              }}
              onDecrement={() => {
                void stepperDecrement();
              }}
            />
          ) : null}

          <Pressable
            onPress={onAddPress}
            disabled={selected == null}
            accessibilityRole="button"
            accessibilityLabel="Add to cart"
            accessibilityState={{
              disabled: selected == null,
            }}
            style={{
              minWidth: 150,
              height: 52,
              paddingHorizontal: 24,
              borderRadius: 16,
              backgroundColor: BRAND,
              alignItems: 'center',
              justifyContent: 'center',
              opacity:
                selected == null
                  ? 0.4
                  : 1,
            }}
          >
            <RNText
              style={{
                color: '#FFFFFF',
                fontSize: 15,
                fontWeight: '800',
              }}
            >
              Add to cart
            </RNText>
          </Pressable>
        </View>
      </View>

      {/* ============================================================
          PRODUCT DETAILS SHEET
          ============================================================ */}

      <ProductDetailsSheet
        detail={
          sheetOpen
            ? detailData
            : null
        }
        selectedTitle={
          selected?.title ?? null
        }
        selectedPriceInPaise={
          selected?.priceInPaise ??
          null
        }
        selectedCompareAtInPaise={
          selected?.compareAtPriceInPaise ??
          null
        }
        onAdd={onAddPress}
        onClose={() =>
          setSheetOpen(false)
        }
      />
    </View>
  );
}

/* ================================================================
   CIRCULAR HERO BUTTON
   ================================================================ */

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
      style={{
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 28,
        backgroundColor:
          'rgba(255,255,255,0.92)',
      }}
    >
      <Ionicons
        name={icon}
        size={24}
        color={INK}
      />
    </Pressable>
  );
}