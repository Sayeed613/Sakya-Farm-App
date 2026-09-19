import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';

import { catalogApi } from '../../api/catalog';
import { useGuestCartStore } from '../../stores/guest-cart-store';
import type { ProductDetail, ProductListItem } from '@sakya/types';
import { formatMoney } from '../../lib/format';
import { ProductVariantSelector } from './ProductVariantSelector';
import { SkeletonBlock } from '../LoadingSkeleton';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

export interface VariantPickerState {
  /** The list item the user tapped ADD on. */
  product: ProductListItem;
}

/**
 * VariantPickerSheet — the compact "choose your selling unit" sheet.
 *
 * Opened by a card's ADD when the product has multiple available variants.
 * Shows the product's real variants (from the detail cache — fetched once per
 * product per session, shared with the quick view and detail page) with the
 * unit-aware selector; adding uses the EXACT selected variant.
 */
export function VariantPickerSheet({
  pick,
  onClose,
  onAdded,
}: {
  pick: VariantPickerState | null;
  onClose: () => void;
  /** Called with the variant the customer added — lets a host surface
   *  (e.g. the product deck footer) mirror the selection. */
  onAdded?: (variant: ProductDetail['variants'][number]) => void;
}) {
  const insets = useSafeAreaInsets();
  const slug = pick?.product.slug ?? '';
  const detail = useQuery({
    queryKey: ['catalog', 'product', slug],
    queryFn: () => catalogApi.getProduct(slug),
    enabled: slug.length > 0,
    staleTime: 120_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const variants = detail.data?.variants ?? [];
  const available = variants.filter((variant) => variant.isAvailable);
  const selected = available.find((variant) => variant.id === selectedId) ?? null;

  const close = () => {
    setSelectedId(null);
    onClose();
  };

  return (
    <Modal
      visible={pick != null}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={close}
    >
      {/* Backdrop fades; the sheet slides. One animation per element. */}
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss variant picker"
        onPress={close}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable onPress={() => undefined}>
          <Animated.View
            entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
            exiting={SlideOutDown.duration(190).easing(Easing.in(Easing.cubic))}
            className="rounded-t-[24px] bg-canvas px-4 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}
          >
            <View className="items-center pb-2">
              <View className="h-1 w-10 rounded-full bg-line" />
            </View>

            {pick == null || detail.isPending ? (
              <View className="gap-3 pb-4">
                <SkeletonBlock className="h-16 w-full rounded-2xl" />
                <SkeletonBlock className="h-9 w-2/3 rounded-xl" />
              </View>
            ) : detail.isError || !detail.data ? (
              <View className="gap-2 pb-5">
                <RNText className="text-[14px] font-semibold" style={{ color: INK }}>
                  Could not load options
                </RNText>
                <RNText className="text-[12.5px]" style={{ color: MUTED }}>
                  Please check your connection and try again.
                </RNText>
              </View>
            ) : (
              <PickerBody
                product={pick.product}
                detail={detail.data}
                available={available}
                selected={selected}
                onSelect={(variant) => setSelectedId(variant.id)}
                onAdd={(variant) => {
                  const store = useGuestCartStore.getState();
                  store.rememberPrice(variant.id, variant.priceInPaise);
                  store.rememberLastAdded(pick.product.slug, pick.product.primaryImageUrl);
                  store.addLine(variant.id, 1, {
                    productTitle: pick.product.title,
                    variantTitle: variant.title,
                    imageUrl: pick.product.primaryImageUrl,
                    slug: pick.product.slug,
                  });
                  onAdded?.(variant);
                  close();
                }}
                onClose={close}
              />
            )}
          </Animated.View>
        </Pressable>
      </Pressable>
      </Animated.View>
    </Modal>
  );
}

function PickerBody({
  product,
  detail,
  available,
  selected,
  onSelect,
  onAdd,
  onClose,
}: {
  product: ProductListItem;
  detail: ProductDetail;
  available: ProductDetail['variants'];
  selected: ProductDetail['variants'][number] | null;
  onSelect: (variant: ProductDetail['variants'][number]) => void;
  onAdd: (variant: ProductDetail['variants'][number]) => void;
  onClose: () => void;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        {detail.primaryImageUrl ? (
          <PickerImage uri={detail.primaryImageUrl} />
        ) : (
          <View className="h-14 w-14 items-center justify-center rounded-xl bg-surface-muted">
            <Ionicons name="leaf-outline" size={20} color={MUTED} />
          </View>
        )}
        <View className="flex-1">
          <RNText className="text-[15px] font-bold leading-5" style={{ color: INK }} numberOfLines={2}>
            {product.title}
          </RNText>
          {detail.description != null ? (
            <RNText className="text-[11.5px] leading-4" style={{ color: MUTED }} numberOfLines={1}>
              {detail.description}
            </RNText>
          ) : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-full bg-surface-muted"
        >
          <Ionicons name="close" size={16} color={INK} />
        </Pressable>
      </View>

      <ProductVariantSelector
        variants={available}
        selected={selected}
        onSelect={onSelect}
        showPrices
        size="compact"
      />

      {/* Sticky add bar for the sheet. */}
      <View className="flex-row items-center justify-between pt-1">
        <View>
          {selected ? (
            <View className="flex-row items-baseline gap-1.5">
              <RNText className="text-[16px] font-bold" style={{ color: INK }}>
                {formatMoney(selected.priceInPaise)}
              </RNText>
              {selected.compareAtPriceInPaise != null &&
              selected.compareAtPriceInPaise > selected.priceInPaise ? (
                <RNText className="text-[11px] line-through" style={{ color: MUTED }}>
                  {formatMoney(selected.compareAtPriceInPaise)}
                </RNText>
              ) : null}
            </View>
          ) : (
            <RNText className="text-[12px]" style={{ color: MUTED }}>
              Select a pack size
            </RNText>
          )}
          <RNText className="text-[10px]" style={{ color: MUTED }}>
            Inclusive of all taxes
          </RNText>
        </View>
        <Pressable
          onPress={() => {
            if (selected) onAdd(selected);
          }}
          disabled={selected == null}
          accessibilityRole="button"
          accessibilityLabel="Add selected variant to cart"
          accessibilityState={{ disabled: selected == null }}
          className={'rounded-full px-6 py-3 ' + (selected == null ? 'opacity-40' : 'active:opacity-85')}
          style={{ backgroundColor: BRAND }}
        >
          <RNText className="text-[13.5px] font-bold text-white">Add to Cart</RNText>
        </Pressable>
      </View>
    </View>
  );
}

/** Cached thumbnail with a leaf fallback on failure. */
function PickerImage({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View className="h-14 w-14 items-center justify-center rounded-xl bg-surface-muted">
        <Ionicons name="leaf-outline" size={20} color={MUTED} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: 56, height: 56, borderRadius: 12 }}
      contentFit="cover"
      cachePolicy="disk"
      recyclingKey={uri}
      transition={150}
      onError={() => setFailed(true)}
    />
  );
}
