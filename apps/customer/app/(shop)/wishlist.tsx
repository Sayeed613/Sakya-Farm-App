import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { journeyApi } from '../../src/api/journey';
import { cartApi } from '../../src/api/cart';
import { AuthGate } from '../../src/components/AuthGate';
import { SkeletonBlock } from '../../src/components/LoadingSkeleton';
import { SubScreenHeader } from '../../src/components/navigation/SubScreenHeader';
import { formatMoney } from '../../src/lib/format';
import { useAuthStore } from '../../src/stores/auth-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/**
 * Wishlist — the server book (`GET /wishlist`), synced across devices.
 *
 * Every row carries the server's own availability verdict and the cheapest
 * available variant id: "Add to cart" adds THAT variant (`POST /cart/items`
 * with the same store-scoping as any add), unavailable rows cannot be added
 * and say why. Removal hits `DELETE /wishlist/:slug`, so heart state on
 * product surfaces (which read the same server book) stays consistent.
 */
export default function WishlistScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();

  const wishlist = useQuery({
    queryKey: ['wishlist'],
    queryFn: journeyApi.listWishlist,
    enabled: session !== null,
    staleTime: 30_000,
  });

  const [actionError, setActionError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (productSlug: string) => journeyApi.removeWishlistItem(productSlug),
    onSuccess: (data) => {
      queryClient.setQueryData(['wishlist'], data);
      setActionError(null);
    },
    onError: (error: Error) => setActionError(error.message || 'Could not update your wishlist. Try again.'),
  });

  const moveToCart = useMutation({
    mutationFn: (defaultVariantId: string) => cartApi.addItem({ variantId: defaultVariantId, quantity: 1 }),
    onSuccess: (data) => {
      queryClient.setQueryData(['cart'], data);
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      setActionError(null);
      router.push('/(shop)/cart');
    },
    onError: (error: Error) => setActionError(error.message || 'Could not add to cart. Try again.'),
  });

  if (session === null) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <AuthGate
          icon="heart-outline"
          title="Verify your number to see your wishlist"
          message="Saved products are personal. Verify your phone to continue."
          redirectTo="/(shop)/wishlist"
        />
      </View>
    );
  }

  const items = wishlist.data?.items ?? [];

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <SubScreenHeader title="Wishlist" />

      {actionError !== null ? (
        <View className="mx-4 mt-2 rounded-2xl border px-3 py-2" style={{ borderColor: '#F0C9C4', backgroundColor: '#FDEEEC' }}>
          <RNText accessibilityLiveRegion="polite" className="text-center text-[12px] font-semibold" style={{ color: '#B42318' }}>
            {actionError}
          </RNText>
        </View>
      ) : null}

      {wishlist.isPending ? (
        <View className="gap-3 px-4 pt-3">
          {[0, 1, 2].map((index) => (
            <View key={index} className="flex-row items-center gap-3 rounded-2xl border bg-white p-3" style={{ borderColor: LINE }}>
              <SkeletonBlock className="h-16 w-16 rounded-xl" />
              <View className="flex-1 gap-2">
                <SkeletonBlock className="h-3.5 w-3/4" />
                <SkeletonBlock className="h-3.5 w-1/3" />
              </View>
            </View>
          ))}
        </View>
      ) : wishlist.isError ? (
        <View className="items-center gap-3 px-4 pt-6">
          <Ionicons name="cloud-offline-outline" size={28} color={MUTED} />
          <RNText className="text-center text-[13px]" style={{ color: MUTED }}>
            Your wishlist could not be loaded right now.
          </RNText>
          <Pressable
            onPress={() => void wishlist.refetch()}
            className="rounded-full border px-4 py-2"
            style={{ borderColor: BRAND }}
          >
            <RNText className="text-[12.5px] font-bold" style={{ color: BRAND }}>
              Retry
            </RNText>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View className="items-center gap-3 px-8 pt-16">
          <Ionicons name="heart-outline" size={44} color={MUTED} />
          <RNText className="text-[15px] font-bold" style={{ color: INK }}>
            Nothing saved yet
          </RNText>
          <RNText className="text-center text-[13px] leading-5" style={{ color: MUTED }}>
            Tap the heart on any product to save it here for later.
          </RNText>
          <Pressable
            onPress={() => router.push('/(shop)')}
            className="mt-2 h-11 items-center justify-center rounded-full px-6"
            style={{ backgroundColor: BRAND }}
          >
            <RNText className="text-[13px] font-bold text-white">Start shopping</RNText>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} className="gap-3">
          {items.map((item) => (
            <View
              key={item.id}
              className="flex-row items-center gap-3 rounded-2xl border bg-white p-3"
              style={{ borderColor: LINE }}
            >
              <Pressable
                onPress={() => router.push(`/(shop)/products/${item.productSlug}` as never)}
                className="h-16 w-16 items-center justify-center overflow-hidden rounded-xl"
                style={{ backgroundColor: '#F3EDE3' }}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Open ${item.productTitle}`}
              >
                {item.imageUrl !== null ? (
                  <Image source={{ uri: item.imageUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                ) : (
                  <Ionicons name="image-outline" size={20} color={MUTED} />
                )}
              </Pressable>

              <Pressable
                onPress={() => router.push(`/(shop)/products/${item.productSlug}` as never)}
                className="flex-1"
              >
                <RNText className="text-[13.5px] font-semibold" style={{ color: INK }} numberOfLines={2}>
                  {item.productTitle}
                </RNText>
                {item.isAvailable && item.priceInPaise !== null ? (
                  <RNText className="mt-0.5 text-[13px] font-bold" style={{ color: BRAND }}>
                    {formatMoney(item.priceInPaise)}
                    {item.compareAtPriceInPaise !== null && item.compareAtPriceInPaise > item.priceInPaise ? (
                      <RNText style={{ color: MUTED, textDecorationLine: 'line-through', fontWeight: '400' }}>
                        {'  '}{formatMoney(item.compareAtPriceInPaise)}
                      </RNText>
                    ) : null}
                  </RNText>
                ) : (
                  <RNText className="mt-0.5 text-[12px]" style={{ color: '#B3453E' }}>
                    Currently unavailable
                  </RNText>
                )}
              </Pressable>

              {item.isAvailable && item.defaultVariantId !== null ? (
                <Pressable
                  onPress={() => moveToCart.mutate(item.defaultVariantId as string)}
                  disabled={moveToCart.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.productTitle} to cart`}
                  className="h-9 items-center justify-center rounded-full px-4"
                  style={{ backgroundColor: BRAND, opacity: moveToCart.isPending ? 0.6 : 1 }}
                >
                  <RNText className="text-[12px] font-bold text-white">
                    {moveToCart.isPending && moveToCart.variables === item.defaultVariantId ? 'Adding…' : 'Add to cart'}
                  </RNText>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => remove.mutate(item.productSlug)}
                disabled={remove.isPending}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.productTitle} from wishlist`}
                hitSlop={8}
                className="ml-1 h-9 w-9 items-center justify-center"
              >
                <Ionicons name="heart" size={20} color="#B3453E" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
