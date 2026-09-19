import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import type { ProductListItem } from '@sakya/types';
import { formatMoney, formatPackSize } from '../../lib/format';
import { deriveBadges } from '../../lib/product-badges';
import { AnimatedPressable, usePressScale } from '../../lib/motion';
import { useProductAdd } from '../../lib/use-product-add';
import { QuantityStepper } from './QuantityStepper';

const BRAND = '#0B594C';
const RUST = '#B4612F';
const MUSTARD = '#C99A2E';
const MUTED = '#8C8A80';
const INK = '#171A18';

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
  onError,
}: {
  uri: string;
  style?: object;
  onError?: () => void;
}) {
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
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
 * The catalogue card.
 *
 * Both layouts share one body: price row with the ADD control INLINE beside it
 * (right-aligned), then title, then the pack line. The image carries the pack
 * pill (grid) and badges — no floating controls over the image edge.
 */
function ProductCardInner({
  product,
  onPress,
  onQuickView,
  onPickVariant,
  variant = 'rail',
  width,
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
  // The list payload's availableVariantCount is the server's own word on how
  // many selling units are choosable — no detail fetch needed to decide.
  const needsPicker = !soldOut && product.availableVariantCount > 1 && onPickVariant != null;
  const hasMrp =
    product.compareAtMaxInPaise != null &&
    product.price?.minInPaise != null &&
    product.compareAtMaxInPaise > product.price.minInPaise;

  const images = product.imageUrls ?? (product.primaryImageUrl ? [product.primaryImageUrl] : []);
  const cardStyle = width != null ? { width } : undefined;
  // Grid cards use a wider crop (Blinkit listing shape); rails stay square.
  const aspect = isGrid ? 1.15 : 1;

  /** The ADD / stepper control — sits beside the price in BOTH layouts. */
  const addControl = soldOut ? (
    <View className="h-8 items-center justify-center rounded-lg border border-line bg-surface-muted px-3">
      <RNText className="text-[10.5px] font-bold" style={{ color: MUTED }}>
        Notify Me
      </RNText>
    </View>
  ) : needsPicker ? (
    // Routes to the caller's variant picker instead of blind-adding.
    <Pressable
      onPress={() => onPickVariant?.(product)}
      accessibilityRole="button"
      accessibilityLabel={`Choose pack size for ${product.title}`}
      className="h-8 items-center justify-center rounded-lg border border-brand bg-brand px-3.5 active:opacity-85"
    >
      <RNText className="text-[12px] font-bold uppercase tracking-wide text-white">Add</RNText>
    </Pressable>
  ) : (
    <QuantityStepper
      quantity={quantity}
      disabled={resolving}
      onAdd={() => void add()}
      onIncrement={() => void increment()}
      onDecrement={decrement}
    />
  );

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`View ${product.title}`}
      onPress={() => (opensSheet ? onQuickView(product) : onPress(product))}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[press.animatedStyle, cardStyle]}
      className="overflow-hidden rounded-2xl border border-line bg-white"
    >
      <View style={{ aspectRatio: aspect, width: '100%' }} className="bg-surface-muted">
        {images.length > 0 && !imageFailed ? (
          <ProductImage
            uri={images[0] ?? ''}
            style={{ width: '100%', height: '100%' }}
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

        {/* Badge stack, top-left of the image (never over the sold-out overlay). */}
        {!soldOut ? (
          <View className="absolute left-1.5 top-1.5 flex-col items-start gap-1">
            {badges.isNew ? <BadgePill icon="sparkles-outline" label="New" color={BRAND} /> : null}
            {badges.isBestseller ? <BadgePill icon="flame" label="Bestseller" color={RUST} /> : null}
            {badges.discountPercent != null ? (
              <BadgePill icon="pricetag" label={`${badges.discountPercent}% OFF`} color={MUSTARD} />
            ) : null}
          </View>
        ) : null}

        {isGrid ? (
          /* Pack-size pill, bottom-left of the image. */
          <View className="absolute bottom-1.5 left-1.5 rounded-full bg-white px-2 py-0.5">
            <RNText className="text-[10.5px] font-bold" style={{ color: INK }}>
              {variantTitles[0] ?? '1 pc'}
            </RNText>
          </View>
        ) : null}
      </View>

      <View className="gap-0.5 px-2.5 pb-2.5 pt-2">
        {/* Price + ADD, side by side on one line. */}
        <View className="flex-row items-center justify-between gap-1.5">
          {product.price?.minInPaise != null ? (
            <View className="flex-1 flex-row items-baseline gap-1.5">
              <RNText className="text-[14px] font-bold" style={{ color: INK }}>
                {formatMoney(product.price.minInPaise)}
              </RNText>
              {hasMrp ? (
                <RNText className="text-[11px] line-through" style={{ color: MUTED }}>
                  {formatMoney(product.compareAtMaxInPaise ?? 0)}
                </RNText>
              ) : null}
            </View>
          ) : (
            <View className="flex-1">
              <RNText className="text-[12px]" style={{ color: MUTED }}>
                Price unavailable
              </RNText>
            </View>
          )}
          {addControl}
        </View>

        <RNText
          className="text-[13.5px] font-semibold leading-5"
          style={{ color: INK }}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {product.title}
        </RNText>

        <RNText className="text-[11.5px] leading-4" style={{ color: MUTED }} numberOfLines={1}>
          {variantTitles.length > 1
            ? `${variantTitles[0] ?? ''} + ${variantTitles.length - 1} more`
            : variantTitles[0] ?? packLine}
        </RNText>
      </View>
    </AnimatedPressable>
  );
}

export const ProductCard = memo(ProductCardInner);
