import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cartApi } from '../../../src/api/cart';
import { ErrorState } from '../../../src/components/ErrorState';
import { LoadingState } from '../../../src/components/LoadingState';
import { formatMoney } from '../../../src/lib/format';
import { useAuthStore } from '../../../src/stores/auth-store';

import { CartBackdrop } from './CartBackdrop';
import { CartHeaderBar } from './CartHeaderBar';
import { CartItemCard } from './CartItemCard';
import { EmptyCart } from './EmptyCart';

const SUBTLE = '#8C8A80';
const BRAND = '#0B594C';
/** Filled stepper + savings rows. Deliberately lighter than BRAND. */
const GREEN = '#1F7A43';
const LINE = '#E9E3D8';
/** Coupon ticket accent. */
const ACCENT = '#B4612F';
/** Editorial copy over the header artwork. */
const HERO_GREEN = '#094A3C';

/**
 * Authenticated cart — the server cart, rendered screen-wide.
 *
 * Fixed:  header artwork + header row + hero copy, and the whole bottom
 *         stack (add more / price details / checkout).
 * Scroll: the product cards, and nothing else.
 *
 * Coupons live on CHECKOUT only (the cart shows their effect as the
 * Discount row in Price Details). The cart query here shares its `['cart']`
 * key with checkout and CouponBox, so every mutation — including a coupon
 * applied on checkout — just writes the server's response back into the
 * query cache.
 */
export default function AuthenticatedCartScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();
  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: cartApi.getCart,
    // cart.tsx only mounts this screen when signed in; the guard is kept so a
    // session drop mid-flight can never fetch the server cart unauthenticated
    // (that just produced 401s and a retry on every guest visit).
    enabled: session !== null,
  });

  const update = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      cartApi.updateItem(id, { quantity }),
    onSuccess: (data) => {
      queryClient.setQueryData(['cart'], data);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => cartApi.removeItem(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['cart'], data);
    },
  });

  if (cart.isLoading) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <CartBackdrop />
        <CartHeaderBar count={0} />
        <View className="flex-1 items-center justify-center">
          <LoadingState />
        </View>
      </View>
    );
  }

  // A failed load is never an empty cart: surface Retry instead of the
  // "Your cart is empty" empty state.
  if (cart.isError || cart.data === undefined) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <CartBackdrop />
        <CartHeaderBar count={0} />
        <View className="flex-1 items-center justify-center">
          <ErrorState
            title="Could not load your cart"
            message="We could not reach your cart just now. Check your connection and try again."
            onRetry={() => void cart.refetch()}
          />
        </View>
      </View>
    );
  }

  const data = cart.data;
  const items = data.items;

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const unavailableCount = items.filter((item) => !item.isAvailable).length;
  const checkoutDisabled = items.length === 0 || unavailableCount > 0;

  const busy = update.isPending || remove.isPending;

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <CartBackdrop />
      <CartHeaderBar count={itemCount} />

      {/* Editorial copy over the artwork — part of the fixed chrome. */}
      <View className="px-4 pt-5 pb-2">
        <RNText
          className="font-serif text-[23px] leading-[28px] font-bold"
          style={{ color: HERO_GREEN }}
        >
          {'Good food\nbrings good days'}
        </RNText>
        <RNText
          className="mt-1.5 text-[12px] font-semibold"
          style={{ color: HERO_GREEN }}
        >
          Farm fresh, straight to your home.
        </RNText>
      </View>

      {items.length === 0 ? (
        <View className="flex-1 items-center justify-center pb-16">
          <EmptyCart onBrowse={() => router.push('/(shop)')} />
        </View>
      ) : (
        <>
          {/* ============================================================
              SCROLLABLE — one white card per product
              ============================================================ */}

          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            bounces={true}
            contentContainerStyle={{ paddingBottom: 2 }}
          >
            {items.map((item) => (
              <CartItemCard
                key={item.id}
                item={item}
                busy={busy}
                onQuantity={(quantity) => update.mutate({ id: item.id, quantity })}
                onRemove={() => remove.mutate(item.id)}
                updateError={
                  update.isError && update.variables?.id === item.id
                    ? update.error?.message || 'Could not update quantity. Try again.'
                    : null
                }
                removeError={
                  remove.isError && remove.variables === item.id
                    ? remove.error?.message || 'Could not remove the item. Try again.'
                    : null
                }
              />
            ))}
          </ScrollView>

          {/* ============================================================
              FIXED BOTTOM STACK
              ============================================================ */}

          <View className="px-3 pt-2">
            {/* ---------------- ADD MORE ---------------- */}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add more items"
              onPress={() => router.push('/(shop)')}
              className="h-[52px] flex-row items-center gap-3 rounded-[16px] bg-white px-3.5 active:opacity-80"
            >
              <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-[#E3EFE9]">
                <Ionicons name="add" size={19} color={BRAND} />
              </View>

              <RNText className="min-w-0 flex-1 text-[13.5px] font-bold text-brand">
                Add more items
              </RNText>

              <Ionicons name="chevron-forward" size={18} color={SUBTLE} />
            </Pressable>

            {/* ---------------- PRICE DETAILS ---------------- */}

            <View className="mt-3 rounded-[16px] bg-white px-4 py-3.5">
              <RNText className="mb-2 text-[15px] font-extrabold text-ink">
                Price Details
              </RNText>

              <View className="mb-1.5 flex-row items-center justify-between">
                <RNText className="text-[12.5px] text-[#6F6C63]">
                  {`Items total (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`}
                </RNText>
                <RNText className="text-[12.5px] font-semibold text-ink">
                  {formatMoney(data.subtotalInPaise)}
                </RNText>
              </View>

              {data.discountInPaise > 0 ? (
                <View className="mb-1.5 flex-row items-center justify-between">
                  <RNText className="text-[12.5px] text-[#6F6C63]">Discount</RNText>
                  <RNText
                    className="text-[12.5px] font-semibold"
                    style={{ color: GREEN }}
                  >
                    {`−${formatMoney(data.discountInPaise)}`}
                  </RNText>
                </View>
              ) : null}

              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1">
                  <RNText className="text-[12.5px] text-[#6F6C63]">
                    Delivery charges
                  </RNText>
                  <Ionicons
                    name="information-circle-outline"
                    size={13}
                    color={SUBTLE}
                  />
                </View>

                {data.shipingInPaise > 0 ? (
                  <RNText className="text-[12.5px] font-semibold text-ink">
                    {formatMoney(data.shipingInPaise)}
                  </RNText>
                ) : (
                  <RNText
                    className="text-[12.5px] font-semibold"
                    style={{ color: GREEN }}
                  >
                    FREE
                  </RNText>
                )}
              </View>

              <View
                className="mt-2.5 flex-row items-center justify-between border-t pt-2.5"
                style={{ borderColor: LINE }}
              >
                <RNText className="text-[14.5px] font-extrabold text-ink">
                  Total amount
                </RNText>
                <RNText className="text-[16.5px] font-extrabold text-ink">
                  {formatMoney(data.totalInPaise)}
                </RNText>
              </View>

              <RNText className="mt-2 text-[10.5px] leading-[14px] text-[#8C8A80]">
                Prices are inclusive of all applicable taxes.
              </RNText>
            </View>

            {/* ---------------- UNAVAILABLE WARNING ---------------- */}

            {unavailableCount > 0 ? (
              <RNText
                className="mt-2 text-center text-[11px] font-semibold"
                style={{ color: ACCENT }}
              >
                Remove unavailable items to check out.
              </RNText>
            ) : null}

            {/* ---------------- CHECKOUT ---------------- */}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Proceed to checkout"
              disabled={checkoutDisabled}
              onPress={() => router.push('/(shop)/checkout')}
              className={`mt-3 h-[52px] w-full flex-row items-center justify-center gap-2 rounded-[16px] bg-brand${
                checkoutDisabled ? ' opacity-50' : ' active:opacity-85'
              }`}
              style={{ marginBottom: Math.max(insets.bottom, 10) }}
            >
              <RNText className="text-[16px] font-bold text-white">
                Proceed to Checkout
              </RNText>

              <RNText className="text-[14.5px] font-bold text-white">
                {formatMoney(data.totalInPaise)}
              </RNText>

              <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
