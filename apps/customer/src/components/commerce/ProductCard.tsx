import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import type { ProductDetail, ProductListItem } from '@sakya/types';
import { catalogApi } from '../../api/catalog';
import { router } from 'expo-router';
import { formatMoney, formatPackSize } from '../../lib/format';
import { cdnImageUri } from '../../lib/cdn-image';
import { deriveBadges, deriveMerchBadges } from '../../lib/product-badges';
import { AnimatedPressable, usePressScale } from '../../lib/motion';
import { cardShadow } from '../../lib/shadows';
import { useProductAdd } from '../../lib/use-product-add';
import { ClickableDiv, IS_WEB } from './ClickableDiv';
import { NotifyMeButton } from './NotifyMeButton';
import { QuantityStepper } from './QuantityStepper';

const ADD_GREEN = '#0C831F'; // Blinkit action green
const INK = '#1D2119';
const MUTED = '#7C7A72';
const STRIKE = '#9C9A92';
const RUST = '#B4612F';
const MUSTARD = '#C99A2E';

/**
 * Product image via expo-image.
 *
 * expo-image caches decoded images on disk AND memory (the RN core Image
 * re-decodes from the HTTP cache every mount, which is why listing images
 * "loaded late"), downsamples to the view size, and cross-fades on decode.
 * `recyclingKey` lets lists reuse the native view when a card scrolls.
 */
function ProductImage({
  uri,
  style,
  fit = 'cover',
  onError,
}: {
  uri: string;
  style?: object;
  /**
   * 'contain' → the FULL image is visible (single-photo products like a ghee
   * jar are never cropped). 'cover' → fills the well (multi-photo products).
   */
  fit?: 'cover' | 'contain';
  onError?: () => void;
}) {
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={fit}
      transition={180}
      cachePolicy="disk"
      recyclingKey={uri}
      onError={onError}
      accessibilityLabel="Product image"
    />
  );
}

export interface ProductCardProps {
  product: ProductListItem;
  onPress: (product: ProductListItem) => void;
  /**
   * Layout: 'rail' (default, compact horizontal-rail card) or 'grid' (listing
   * grid with the pack pill on the image). Independent of tap behavior.
   */
  variant?: 'rail' | 'grid';
  /**
   * Quick-view trigger: tapping the card (or its image) opens the bottom sheet
   * instead of navigating. When absent, taps call `onPress` in both variants.
   */
  onQuickView?: (product: ProductListItem) => void;
  /**
   * Present = multi-variant products route their ADD here (picker) instead of
   * adding an arbitrary variant. Single-variant products still add directly.
   */
  onPickVariant?: (product: ProductListItem) => void;
  /** Fixed card width (horizontal rails). Grid mode sizes via its column. */
  width?: number;
  /** White backing for the ADD control when the card sits on imagery. */
  elevated?: boolean;
}

/** One badge pill: icon + label on the image's top-left. */
function BadgePill({ icon, label, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }) {
  return (
    <View
      className="flex-row items-center gap-1 rounded-full px-1.5 py-0.5"
      style={{ backgroundColor: 'rgba(255,255,255,0.94)' }}
    >
      <Ionicons name={icon} size={10} color={color} />
      <RNText className="text-[9.5px] font-bold" style={{ color }}>
        {label}
      </RNText>
    </View>
  );
}

/**
 * The catalogue card — Blinkit anatomy.
 *
 *   ┌──────────────────┐
 *   │     [image]      │   square well, badges top-left
 *   ├──────────────────┤
 *   │ Title            │
 *   │ 500 g            │   pack line
 *   │ ₹42  ₹55         │   price + strikethrough MRP
 *   │          [ADD]   │   outlined ADD, bottom-right
 *   └──────────────────┘
 *
 * The ADD control is outlined (green border + green text) and sits on its own
 * line below the price, right-aligned; the stepper swaps in place so the card
 * never shifts. Sold-out renders a "Notify Me" control instead.
 */
function ProductCardInner({
  product,
  onPress,
  onQuickView,
  onPickVariant,
  variant = 'rail',
  width,
  elevated = false,
}: ProductCardProps) {
  const { quantity, add, increment, decrement, resolving } = useProductAdd(product);
  const press = usePressScale();
  const [imageFailed, setImageFailed] = useState(false);

  const isGrid = variant === 'grid';
  const opensSheet = onQuickView != null;
  const badges = deriveBadges(product);

  const variantTitles = product.variantTitles ?? [];
  const packLine = formatPackSize({
    variantTitles,
    variantCount: product.variantCount,
    vendor: product.vendor,
    categoryNames: product.categories.map((category) => category.name),
  });

  const soldOut = badges.isOutOfStock;
  const needsPicker = !soldOut && product.availableVariantCount > 1 && onPickVariant != null;
  const merchBadges = deriveMerchBadges(product);
  const hasMrp =
    product.compareAtMaxInPaise != null &&
    product.price?.minInPaise != null &&
    product.compareAtMaxInPaise > product.price.minInPaise;

  const images = (product.imageUrls ?? (product.primaryImageUrl ? [product.primaryImageUrl] : []))
    .map((uri) => cdnImageUri(uri, isGrid ? 320 : 220))
    .filter((uri): uri is string => uri !== null);
  const cardStyle = width != null ? { width } : undefined;

  /** The ADD / stepper control — Blinkit stacks it under the price. */
  const addControl = soldOut ? (
    <NotifyMeControl productId={product.id} productSlug={product.slug} />
  ) : needsPicker ? (
    // Multi-variant ADD routes to the caller's variant picker. Web note: this
    // control renders inside the card's outer Pressable — a nested Pressable
    // becomes a nested <button> on web (invalid HTML), so web uses the
    // ClickableDiv wrapper, which stays clickable without nesting buttons.
    IS_WEB ? (
      <ClickableDiv
        // No accessibilityRole="button" — it would render the div as a
        // <button> on web again (nested-button hydration error).
        accessibilityLabel={`Choose pack size for ${product.title}`}
        onClick={() => onPickVariant?.(product)}
        className="h-8 cursor-pointer items-center justify-center rounded-lg px-4"
        style={{
          borderWidth: 1.5,
          borderColor: ADD_GREEN,
          backgroundColor: elevated ? '#FFFFFF' : 'transparent',
        }}
      >
        <RNText className="text-[12px] font-extrabold" style={{ color: ADD_GREEN }}>
          ADD
        </RNText>
      </ClickableDiv>
    ) : (
      <Pressable
        onPress={() => onPickVariant?.(product)}
        accessibilityRole="button"
        accessibilityLabel={`Choose pack size for ${product.title}`}
        className="h-8 items-center justify-center rounded-lg px-4 active:opacity-70"
        style={{
          borderWidth: 1.5,
          borderColor: ADD_GREEN,
          backgroundColor: elevated ? '#FFFFFF' : 'transparent',
        }}
      >
        <RNText className="text-[12px] font-extrabold" style={{ color: ADD_GREEN }}>
          ADD
        </RNText>
      </Pressable>
    )
  ) : null; // rendered below, beside the price row

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`View ${product.title}`}
      onPress={() => (opensSheet ? onQuickView(product) : onPress(product))}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[press.animatedStyle, cardStyle, cardShadow]}
      className="rounded-2xl bg-white"
    >
      {/**
       * Inner clipping layer: rounded corners clip the image while the
       * shadow stays on the outer layer (RN masks the shadow of a view
       * that also clips its own children).
       */}
      <View className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white">
        {/* Image well */}
        <View style={{ aspectRatio: 1, width: '100%' }} className="bg-surface-muted">
          {images.length > 0 && !imageFailed ? (
            <ProductImage
              uri={images[0] ?? ''}
              style={{ width: '100%', height: '100%' }}
              fit={images.length === 1 ? 'contain' : 'cover'}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View className="h-full w-full items-center justify-center gap-1">
              <Ionicons name="leaf-outline" size={28} color={MUTED} />
              <RNText className="text-[11px]" style={{ color: MUTED }}>
                Sakya Farms
              </RNText>
            </View>
          )}
          {soldOut ? <View className="absolute inset-0 bg-white/70" /> : null}

          {!soldOut ? (
            <View className="absolute left-1.5 top-1.5 flex-col items-start gap-1">
              {badges.isNew ? <BadgePill icon="sparkles-outline" label="New" color={ADD_GREEN} /> : null}
              {badges.isBestseller ? <BadgePill icon="flame" label="Bestseller" color={RUST} /> : null}
              {merchBadges.includes('premium') ? <BadgePill icon="star" label="Premium" color={MUSTARD} /> : null}
              {merchBadges.includes('fresh') ? <BadgePill icon="leaf" label="Fresh" color={ADD_GREEN} /> : null}
              {badges.discountPercent != null ? (
                <BadgePill icon="pricetag" label={`${badges.discountPercent}% OFF`} color={MUSTARD} />
              ) : null}
            </View>
          ) : null}

          {isGrid ? (
            <View className="absolute bottom-1.5 left-1.5 rounded-full bg-white px-2 py-0.5">
              <RNText className="text-[10.5px] font-bold" style={{ color: INK }}>
                {variantTitles[0] ?? '1 pc'}
              </RNText>
            </View>
          ) : null}
        </View>

        {/* Body */}
        <View className="gap-0.5 px-2.5 pb-2.5 pt-2">
          <RNText
            className="text-[13.5px] font-semibold leading-5"
            style={{ color: INK }}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {product.title}
          </RNText>

          {/* Provenance: the real vendor/brand the catalog publishes — never a
              fabricated farm name. Hidden when the payload has no vendor. */}
          {product.vendor ? (
            <View className="flex-row items-center gap-1">
              <Ionicons name="leaf" size={10} color={ADD_GREEN} />
              <RNText className="text-[10.5px] font-semibold" style={{ color: ADD_GREEN }} numberOfLines={1}>
                From {product.vendor}
              </RNText>
            </View>
          ) : null}

          <RNText className="text-[11.5px] leading-4" style={{ color: MUTED }} numberOfLines={1}>
            {variantTitles.length > 1
              ? `${variantTitles[0] ?? ''} + ${variantTitles.length - 1} more`
              : variantTitles[0] ?? packLine}
          </RNText>

          {/* Price + MRP */}
          <View className="mt-1.5 flex-row items-baseline gap-1.5">
            {product.price?.minInPaise != null ? (
              <>
                <RNText className="text-[14.5px] font-extrabold" style={{ color: INK }}>
                  {formatMoney(product.price.minInPaise)}
                </RNText>
                {hasMrp ? (
                  <RNText className="text-[11.5px] line-through" style={{ color: STRIKE }}>
                    {formatMoney(product.compareAtMaxInPaise ?? 0)}
                  </RNText>
                ) : null}
              </>
            ) : (
              <RNText className="text-[12px]" style={{ color: MUTED }}>
                Price unavailable
              </RNText>
            )}
          </View>

          {/* ADD row: picker/notify control, or the stepper at bottom-right */}
          <View className="mt-1.5 flex-row items-center justify-end">
            {soldOut || needsPicker ? (
              addControl
            ) : (
              <QuantityStepper
                quantity={quantity}
                disabled={resolving}
                onAdd={() => void add()}
                onIncrement={() => void increment()}
                onDecrement={decrement}
              />
            )}
          </View>
        </View>
      </View>
    </AnimatedPressable>
  );
}

export const ProductCard = memo(ProductCardInner);

/**
 * Notify Me control for sold-out cards.
 *
 * Resolves the product's default available variant from the SHARED
 * ['catalog','product',slug] cache (the same cache quick-view and the detail
 * page populate) so the alert watches a concrete variant id. Rendered inside
 * the card's outer pressable, so taps must stop propagation to avoid opening
 * the product page.
 */
function NotifyMeControl({ productId, productSlug }: { productId: string; productSlug: string }) {
  const queryClient = useQueryClient();

  const cachedDetail = queryClient.getQueryData<ProductDetail>(['catalog', 'product', productSlug]);
  const detail = useQuery({
    queryKey: ['catalog', 'product', productSlug],
    queryFn: () => catalogApi.getProduct(productSlug),
    enabled: cachedDetail === undefined,
    staleTime: 120_000,
  });

  const resolved = cachedDetail ?? detail.data ?? null;
  const defaultVariantId =
    resolved?.variants.find((candidate) => candidate.isAvailable)?.id ??
    resolved?.variants[0]?.id ??
    null;

  return IS_WEB ? (
    // Web: NotifyMeButton is a ClickableDiv that stops propagation itself —
    // a wrapper Pressable here would be a second nested <button> in the card.
    <NotifyMeButton
      productId={productId}
      variantId={defaultVariantId}
      onRequireAuth={() => router.push('/(auth)/phone')}
    />
  ) : (
    <Pressable onPress={() => {}}>
      <NotifyMeButton
        productId={productId}
        variantId={defaultVariantId}
        onRequireAuth={() => router.push('/(auth)/phone')}
      />
    </Pressable>
  );
}
