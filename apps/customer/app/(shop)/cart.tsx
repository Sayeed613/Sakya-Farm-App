import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cartApi } from '../../src/api/cart';
import { CouponBox } from '../../src/components/cart/CouponBox';
import { EmptyState } from '../../src/components/EmptyState';
import { LoadingState } from '../../src/components/LoadingState';
import { PromoCards } from '../../src/components/commerce/PromoCards';
import { formatMoney } from '../../src/lib/format';
import { goBackOrHome } from '../../src/lib/navigation';
import { useAuthStore } from '../../src/stores/auth-store';
import { useGuestCartStore } from '../../src/stores/guest-cart-store';
import type { AppliedCouponResponse, CartItemResponse } from '@sakya/types';

const INK = '#171A18';
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
 * Guest cart.
 *
 * Guests can add items before signing in — the pill and the product steppers
 * write to the local guest store. This screen used to replace that cart with a
 * "Verify your number" gate, so items a guest had just added became invisible
 * and uneditable until they signed in. Here the real local cart renders with
 * working quantity and remove controls.
 *
 * Totals are display-only: unit prices are captured from catalog data at add
 * time. The server recomputes the authoritative total when the guest cart is
 * merged at sign-in, which is exactly why the total is labelled "estimated".
 */
function GuestCartScreen() {
  const insets = useSafeAreaInsets();
  const lines = useGuestCartStore((state) => state.lines);
  const priceTotals = useGuestCartStore((state) => state.priceTotals);
  const setQuantity = useGuestCartStore((state) => state.setQuantity);
  const removeLine = useGuestCartStore((state) => state.removeLine);

  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const estimated = lines.reduce(
    (sum, line) => sum + (priceTotals[line.variantId] ?? 0) * line.quantity,
    0,
  );

  function signIn() {
    useAuthStore.getState().setPendingRedirect('/(shop)/cart');
    router.push('/(auth)/phone');
  }

  if (lines.length === 0) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <CartBackdrop />
        <CartHeaderBar count={0} />
        <View className="flex-1 items-center justify-center pb-16">
          <EmptyState
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            image={require('../../src/assets/empty-cart.png')}
            title="Your cart is empty"
            message="Add something fresh and it will show up here."
            ctaLabel="Start shopping"
            onCta={() => router.push('/(shop)')}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <CartBackdrop />
      <CartHeaderBar count={itemCount} />

      <View className="px-4 pt-5 pb-2">
        <RNText className="font-serif text-[23px] leading-[28px] font-bold" style={{ color: HERO_GREEN }}>
          {'Good food\nbrings good days'}
        </RNText>
        <RNText className="mt-1.5 text-[12px] font-semibold" style={{ color: HERO_GREEN }}>
          Sign in to place your order.
        </RNText>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 2 }}
      >
        {lines.map((line) => {
          const title = line.display?.productTitle ?? 'Farm product';
          const variant = line.display?.variantTitle ?? '';
          const unit = priceTotals[line.variantId] ?? 0;
          return (
            <View
              key={line.variantId}
              className="mx-3 mt-3 rounded-[16px] bg-white p-3"
              style={{ boxShadow: '0px 2px 6px rgba(58,53,43,0.05)', elevation: 1 }}
            >
              <View className="flex-row gap-3">
                <View className="h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-[12px] bg-[#F3EDE3]">
                  {line.display?.imageUrl ? (
                    <Image
                      source={{ uri: line.display.imageUrl }}
                      style={{ width: 76, height: 76 }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={line.variantId}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <Ionicons name="leaf-outline" size={22} color={SUBTLE} />
                  )}
                </View>

                <View className="min-w-0 flex-1">
                  <View className="flex-row items-start">
                    <View className="min-w-0 flex-1 pr-2">
                      <RNText numberOfLines={2} className="text-[13.5px] leading-[18px] font-bold text-ink">
                        {title}
                      </RNText>
                      {variant !== '' ? (
                        <RNText numberOfLines={1} className="mt-0.5 text-[11.5px] leading-[15px] text-[#6F6C63]">
                          {variant}
                        </RNText>
                      ) : null}
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${title}`}
                      hitSlop={8}
                      onPress={() => removeLine(line.variantId)}
                      className="active:opacity-60"
                    >
                      <Ionicons name="trash-outline" size={18} color={SUBTLE} />
                    </Pressable>
                  </View>

                  <View className="mt-2 flex-row items-center justify-between">
                    <RNText className="text-[14px] font-extrabold text-ink">
                      {unit > 0 ? formatMoney(unit * line.quantity) : '—'}
                    </RNText>

                    <View
                      className="h-[34px] min-w-[104px] flex-row items-center justify-between rounded-full px-1.5"
                      style={{ backgroundColor: GREEN }}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Decrease quantity"
                        hitSlop={6}
                        onPress={() => setQuantity(line.variantId, line.quantity - 1)}
                        className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
                      >
                        <RNText className="text-[19px] leading-[23px] font-bold text-white">−</RNText>
                      </Pressable>

                      <RNText className="min-w-[20px] text-center text-[14px] font-extrabold text-white">
                        {line.quantity}
                      </RNText>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Increase quantity"
                        hitSlop={6}
                        onPress={() => setQuantity(line.variantId, line.quantity + 1)}
                        className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
                      >
                        <RNText className="text-[19px] leading-[23px] font-bold text-white">+</RNText>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View className="px-3 pt-2">
        <View className="mt-3 rounded-[16px] bg-white px-4 py-3.5">
          <View className="flex-row items-center justify-between">
            <RNText className="text-[13px] text-[#6F6C63]">
              {`Estimated total (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`}
            </RNText>
            <RNText className="text-[15px] font-extrabold text-ink">
              {estimated > 0 ? formatMoney(estimated) : '—'}
            </RNText>
          </View>
          <RNText className="mt-1.5 text-[11px] leading-4 text-[#8C8A80]">
            Final prices, taxes and delivery are calculated on the server after you sign in.
          </RNText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in to checkout"
          onPress={signIn}
          className="mt-3 h-[52px] w-full flex-row items-center justify-center gap-2 rounded-[16px] bg-brand active:opacity-85"
          style={{ marginBottom: Math.max(insets.bottom, 10) }}
        >
          <RNText className="text-[16px] font-bold text-white">Sign in to checkout</RNText>
          <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();
  /** The coupon row can be forced open by the promo cards (apply / qualify). */
  const [couponOpen, setCouponOpen] = useState(false);

  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: cartApi.getCart,
    // Guests render GuestCartScreen below and never touch the server cart:
    // fetching it unauthenticated just produced 401s (and a retry) on every
    // guest visit to the cart.
    enabled: session !== null,
  });

  const update = useMutation({
    mutationFn: ({
      id,
      quantity,
    }: {
      id: string;
      quantity: number;
    }) => cartApi.updateItem(id, { quantity }),

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

  /** Promo card 2 applies SAKYA100 straight through the server cart. */
  const applyPromo = useMutation({
    mutationFn: () => cartApi.applyCoupon('SAKYA100'),
    onSuccess: (data) => {
      queryClient.setQueryData(['cart'], data);
      setCouponOpen(true);
    },
  });

  /* --------------------------------------------------------------------------
   * NOT LOGGED IN
   * -------------------------------------------------------------------------- */

  if (session === null) {
    return <GuestCartScreen />;
  }

  /* --------------------------------------------------------------------------
   * LOADING
   * -------------------------------------------------------------------------- */

  if (cart.isLoading) {
    return <LoadingState />;
  }

  const data = cart.data;
  const items = data?.items ?? [];

  const itemCount = items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  const unavailableCount = items.filter(
    (item) => !item.isAvailable,
  ).length;

  const checkoutDisabled = items.length === 0 || unavailableCount > 0;

  /* --------------------------------------------------------------------------
   * MAIN SCREEN
   *
   * Fixed:  header artwork + header row + hero copy, and the whole bottom
   *         stack (add more / coupon / price details / checkout).
   * Scroll: the product cards, and nothing else.
   * -------------------------------------------------------------------------- */

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <CartBackdrop />

      <CartHeaderBar count={items.length} />

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
        <View className="flex-1 items-center justify-center gap-3 px-6 pb-12">
          <RNText className="text-center text-[13px] font-semibold text-[#8C8A80]">
            Your cart is empty
          </RNText>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start shopping"
            onPress={() => router.push('/(shop)')}
            className="rounded-full border-[1.5px] border-brand px-[18px] py-2 active:opacity-65"
          >
            <RNText className="text-[13px] font-bold text-brand">
              Start shopping
            </RNText>
          </Pressable>
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
                busy={update.isPending || remove.isPending}
                onQuantity={(quantity) =>
                  update.mutate({ id: item.id, quantity })
                }
                onRemove={() => remove.mutate(item.id)}
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

            {/* ---------------- OFFERS ---------------- */}

            <PromoCards
              subtotalInPaise={data?.subtotalInPaise ?? 0}
              shippingInPaise={data?.shippingInPaise ?? 0}
              couponCode={data?.coupon?.code ?? null}
              onPickCoupon={() => setCouponOpen(true)}
              applyCoupon={() => applyPromo.mutate()}
            />

            {/* ---------------- APPLY COUPON ---------------- */}

            <ApplyCouponCard coupon={data?.coupon ?? null} forceOpen={couponOpen} />

            {/* ---------------- PRICE DETAILS ---------------- */}

            <View className="mt-3 rounded-[16px] bg-white px-4 py-3.5">
              <RNText className="mb-2 text-[15px] font-extrabold text-ink">
                Price Details
              </RNText>

              <View className="mb-1.5 flex-row items-center justify-between">
                <RNText className="text-[12.5px] text-[#6F6C63]">
                  {`Items total (${itemCount} ${
                    itemCount === 1 ? 'item' : 'items'
                  })`}
                </RNText>
                <RNText className="text-[12.5px] font-semibold text-ink">
                  {formatMoney(data?.subtotalInPaise ?? 0)}
                </RNText>
              </View>

              {data !== undefined && data.discountInPaise > 0 ? (
                <View className="mb-1.5 flex-row items-center justify-between">
                  <RNText className="text-[12.5px] text-[#6F6C63]">
                    Discount
                  </RNText>
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

                {data !== undefined && data.shippingInPaise > 0 ? (
                  <RNText className="text-[12.5px] font-semibold text-ink">
                    {formatMoney(data.shippingInPaise)}
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
                  {formatMoney(data?.totalInPaise ?? 0)}
                </RNText>
              </View>
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
                {formatMoney(data?.totalInPaise ?? 0)}
              </RNText>

              <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

/* ===========================================================================
   HEADER ARTWORK

   Landscape photo pinned to the top of the page. Two washes keep the fixed
   chrome readable on top of it: a vertical one that lightens the header strip
   and feathers the photo into the canvas, and a horizontal one on the left so
   the dark-green editorial copy keeps contrast.
   =========================================================================== */

function CartBackdrop() {
  return (
    <View
      pointerEvents="none"
      className="absolute left-0 right-0 top-0 h-[230px]"
    >
      <Image
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../src/images/cart-header.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />

      {/* Light frost under the fixed chrome — keeps the photo textured while
          the header row stays readable. */}
      <BlurView
        pointerEvents="none"
        intensity={28}
        tint="light"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72 }}
      />

      {/* Vertical: light header strip → photo → parchment feather. */}
      <LinearGradient
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        colors={[
          'rgba(255,255,255,0.72)',
          'rgba(255,255,255,0)',
          'rgba(255,255,255,0.22)',
          'rgba(247,243,233,0.98)',
        ]}
        locations={[0, 0.26, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Horizontal: calm the left edge under the serif copy. */}
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.72, y: 0.5 }}
        colors={['rgba(255,255,255,0.62)', 'rgba(255,255,255,0)']}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/* ===========================================================================
   HEADER ROW — flat dark icons on the light strip over the artwork
   =========================================================================== */

function CartHeaderBar({ count }: { count: number }) {
  return (
    <View className="h-12 flex-row items-center justify-between px-2">
      <Pressable
        onPress={goBackOrHome}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        className="h-[38px] w-[38px] items-center justify-center active:opacity-60"
      >
        <Ionicons name="chevron-back" size={23} color={INK} />
      </Pressable>

      <RNText className="text-[15px] font-bold tracking-[-0.1px] text-ink">
        {count > 0 ? `Your Cart (${count})` : 'Your Cart'}
      </RNText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search"
        hitSlop={8}
        onPress={() => router.push('/search')}
        className="h-[38px] w-[38px] items-center justify-center active:opacity-60"
      >
        <Ionicons name="search-outline" size={21} color={INK} />
      </Pressable>
    </View>
  );
}

/* ===========================================================================
   ITEM CARD — one white card per product

   Layout per the reference: 76dp thumbnail on the left, title + variant beside
   it with the trash at the top-right, then ONE full-width row carrying the
   price on the left and the filled green stepper on the right.
   =========================================================================== */

function CartItemCard({
  item,
  busy,
  onQuantity,
  onRemove,
}: {
  item: CartItemResponse;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <View
      className={`mx-3 mt-3 rounded-[16px] bg-white p-3${
        item.isAvailable ? '' : ' opacity-55'
      }`}
      style={{
        boxShadow: '0px 2px 6px rgba(58,53,43,0.05)',
        elevation: 1,
      }}
    >
      <View className="flex-row gap-3">

        {/* ---------------- THUMBNAIL ---------------- */}

        <View className="h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-[12px] bg-[#F3EDE3]">
          {item.productImageUrl !== null ? (
            <Image
              source={{ uri: item.productImageUrl }}
              style={{ width: 76, height: 76 }}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={item.id}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Ionicons name="leaf-outline" size={22} color={SUBTLE} />
          )}
        </View>

        {/* ---------------- TITLE / VARIANT / PRICE / STEPPER ---------------- */}

        <View className="min-w-0 flex-1">

          <View className="flex-row items-start">
            <View className="min-w-0 flex-1 pr-2">
              <RNText
                numberOfLines={2}
                className="text-[13.5px] leading-[18px] font-bold text-ink"
              >
                {item.productTitle}
              </RNText>

              {item.variantTitle !== '' ? (
                <RNText
                  numberOfLines={1}
                  className="mt-0.5 text-[11.5px] leading-[15px] text-[#6F6C63]"
                >
                  {item.variantTitle}
                </RNText>
              ) : null}
            </View>

            {/* Plain grey trash, top-right. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.productTitle}`}
              hitSlop={8}
              disabled={busy}
              onPress={onRemove}
              className="active:opacity-60"
            >
              <Ionicons name="trash-outline" size={18} color={SUBTLE} />
            </Pressable>
          </View>

          {/* Price left, stepper right — one row spanning the card. */}
          <View className="mt-2 flex-row items-center justify-between">
            <RNText className="text-[14px] font-extrabold text-ink">
              {formatMoney(item.lineTotalInPaise)}
            </RNText>

            <View
              className="h-[34px] min-w-[104px] flex-row items-center justify-between rounded-full px-1.5"
              style={{ backgroundColor: GREEN }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                hitSlop={6}
                disabled={busy}
                onPress={() => onQuantity(item.quantity - 1)}
                className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
              >
                <RNText className="text-[19px] leading-[23px] font-bold text-white">
                  −
                </RNText>
              </Pressable>

              <RNText className="min-w-[20px] text-center text-[14px] font-extrabold text-white">
                {item.quantity}
              </RNText>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                hitSlop={6}
                disabled={busy}
                onPress={() => onQuantity(item.quantity + 1)}
                className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
              >
                <RNText className="text-[19px] leading-[23px] font-bold text-white">
                  +
                </RNText>
              </Pressable>
            </View>
          </View>

        </View>
      </View>

      {item.isAvailable ? null : (
        <RNText
          className="mt-2 text-[11px] font-semibold"
          style={{ color: ACCENT }}
        >
          Currently unavailable — remove it to check out.
        </RNText>
      )}
    </View>
  );
}

/* ===========================================================================
   APPLY COUPON — collapsed row that expands to the real coupon control
   =========================================================================== */

function ApplyCouponCard({
  coupon,
  forceOpen = false,
}: {
  coupon: AppliedCouponResponse | null;
  /** Lets the promo cards open the row (apply / qualify) from outside. */
  forceOpen?: boolean;
}) {
  /*
   * Collapsed by default — the reference shows a one-line row, not an open
   * field. An applied coupon forces the expanded state so its Remove action
   * is reachable without another tap.
   */
  const [expanded, setExpanded] = useState(false);
  const open = expanded || coupon !== null || forceOpen;

  return (
    <View className="mt-3 overflow-hidden rounded-[16px] bg-white">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide coupon field' : 'Apply coupon code'}
        accessibilityState={{ expanded: open }}
        disabled={coupon !== null}
        onPress={() => setExpanded((value) => !value)}
        className="h-[52px] flex-row items-center gap-3 px-3.5 active:opacity-80"
      >
        <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-[#F7E9DD]">
          <Ionicons name="ticket-outline" size={17} color={ACCENT} />
        </View>

        <View className="min-w-0 flex-1">
          <RNText className="text-[13.5px] font-bold text-ink">
            Apply coupon code
          </RNText>
          <RNText className="text-[11px] text-[#8C8A80]">
            Get exciting offers and discounts
          </RNText>
        </View>

        {coupon === null ? (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-forward'}
            size={18}
            color={SUBTLE}
          />
        ) : null}
      </Pressable>

      {open ? (
        <View
          className="border-t px-3.5 py-3"
          style={{ borderColor: LINE }}
        >
          <CouponBox coupon={coupon} />
        </View>
      ) : null}
    </View>
  );
}
