import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useMemo } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cartApi } from '../../api/cart';
import { useAuthStore } from '../../stores/auth-store';
import { useGuestCartStore } from '../../stores/guest-cart-store';
import { useQuery } from '@tanstack/react-query';

const BRAND = '#0B594C';
/** How many product circles the pill shows before collapsing into "+N". */
const MAX_CIRCLES = 3;
/** Overlap as a fraction of the circle size (website cart-pill pattern). */
const OVERLAP = 0.5;
const CIRCLE = 32;

export interface StickyCartBarProps {
  itemCount: number;
  onPress: () => void;
  /** Extra lift when layering above another bottom bar (e.g. quick view's). */
  bottomOffset?: number;
}

/**
 * One distinct product, for the pill's circle stack.
 *
 * A product may span several pack-size lines; the pill shows one circle per
 * PRODUCT (like the website), not one per cart line.
 */
interface PillProduct {
  key: string;
  imageUrl: string | null;
}

/**
 * Floating "View Cart" pill with the cart's product images as a fan of small
 * circles, 50% overlapping, newest last — mirroring the website cart pill.
 *
 * Sources: guest lines' display snapshots while browsing as a guest; the
 * server cart's line images once authenticated. Totals are server-owned and
 * shown at checkout, so the pill deliberately shows no price.
 *
 * NOTE: the pill is a sibling of the tab bar, NOT part of it, so hiding the
 * tab bar on a screen does not hide this pill — screens that hide the bar
 * should also skip rendering `<StickyCartBar />` (the product screen does).
 */
function StickyCartBarInner({ itemCount, onPress, bottomOffset = 0 }: StickyCartBarProps) {
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((state) => state.session !== null);
  const guestLines = useGuestCartStore((state) => state.lines);

  // Server cart lines — the same ['cart'] cache the cart screen uses, so the
  // pill updates the moment any cart mutation lands. Fetched only when signed
  // in; guests feed the pill from their local display snapshots.
  const serverCart = useQuery({
    queryKey: ['cart'],
    queryFn: cartApi.getCart,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const products = useMemo<PillProduct[]>(() => {
    if (isAuthenticated) {
      const items = serverCart.data?.items ?? [];
      // Newest purchase intent first: later lines are later adds. Deduplicate
      // by product title (one circle per product, not per pack size).
      const seen = new Set<string>();
      const list: PillProduct[] = [];
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item == null || seen.has(item.productTitle)) continue;
        seen.add(item.productTitle);
        list.push({ key: item.id, imageUrl: item.productImageUrl ?? null });
        if (list.length >= MAX_CIRCLES) break;
      }
      return list;
    }

    const seen = new Set<string>();
    const list: PillProduct[] = [];
    for (let index = guestLines.length - 1; index >= 0; index -= 1) {
      const line = guestLines[index];
      if (!line) continue;
      const title = line.display?.productTitle ?? line.variantId;
      if (seen.has(title)) continue;
      seen.add(title);
      list.push({ key: line.variantId, imageUrl: line.display?.imageUrl ?? null });
      if (list.length >= MAX_CIRCLES) break;
    }
    return list;
  }, [isAuthenticated, serverCart.data, guestLines]);

  if (itemCount <= 0) return null;

  const hiddenCount = Math.max(0, itemCount - MAX_CIRCLES);

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(140)}
      className="absolute self-center"
      style={{
        bottom: Math.max(insets.bottom, 10) + 86 + bottomOffset,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`View cart, ${itemCount} items`}
        className="flex-row items-center rounded-full py-1.5 pl-2 pr-3.5"
        style={{ backgroundColor: BRAND }}
      >
        {/* Product circles, 50% overlapped — newest on top-right. */}
        <View className="flex-row items-center">
          {products.length === 0 ? (
            <View
              className="items-center justify-center rounded-full bg-white/20"
              style={{ width: CIRCLE, height: CIRCLE }}
            >
              <Ionicons name="bag-handle" size={15} color="#FFFFFF" />
            </View>
          ) : (
            products.map((product, index) => (
              <View
                key={product.key}
                className="items-center justify-center overflow-hidden rounded-full border-2 bg-canvas"
                style={{
                  width: CIRCLE,
                  height: CIRCLE,
                  borderColor: '#FFFFFF',
                  // First circle sits flush; each subsequent one overlaps the
                  // previous by half its width, exactly like the website pill.
                  marginLeft: index === 0 ? 0 : -CIRCLE * OVERLAP,
                  zIndex: products.length - index,
                }}
              >
                {product.imageUrl ? (
                  <Image
                    source={{ uri: product.imageUrl }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    cachePolicy="disk"
                    recyclingKey={product.imageUrl}
                    transition={120}
                    accessibilityLabel="Product in cart"
                  />
                ) : (
                  <Ionicons name="leaf" size={13} color={BRAND} />
                )}
              </View>
            ))
          )}
          {hiddenCount > 0 ? (
            <View
              className="items-center justify-center rounded-full border-2 border-white bg-white/25"
              style={{ width: CIRCLE, height: CIRCLE, marginLeft: -CIRCLE * OVERLAP, zIndex: 0 }}
            >
              <RNText className="text-[10px] font-bold text-white">+{hiddenCount}</RNText>
            </View>
          ) : null}
        </View>

        <View style={{ marginLeft: 10 }}>
          <RNText className="text-[13px] font-bold leading-4 text-white">View cart</RNText>
          <RNText className="text-[11px] leading-3.5 text-white/80">
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </RNText>
        </View>
        <Ionicons name="chevron-forward" size={15} color="#FFFFFF" style={{ marginLeft: 6 }} />
      </Pressable>
    </Animated.View>
  );
}

export const StickyCartBar = memo(StickyCartBarInner);

/** Running count from the guest cart store. */
export function useCartSummary(): { itemCount: number } {
  const lines = useGuestCartStore((state) => state.lines);
  const isAuthenticated = useAuthStore((state) => state.session !== null);
  const serverCart = useQuery({
    queryKey: ['cart'],
    queryFn: cartApi.getCart,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const guestCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const serverCount = (serverCart.data?.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  const itemCount = isAuthenticated ? serverCount : guestCount;
  return { itemCount };
}
