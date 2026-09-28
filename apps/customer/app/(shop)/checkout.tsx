import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cartApi } from '../../src/api/cart';
import { journeyApi } from '../../src/api/journey';
import {
  checkoutApi,
  newIdempotencyKey,
  type CheckoutAddress,
  type OnlinePaymentMethod,
} from '../../src/api/checkout';
import type { CartResponse, OrderResponse, PaymentDetail } from '@sakya/types';
import { toPaise } from '@sakya/utils';
import { AddressSheet } from '../../src/components/checkout/AddressSheet';
import { AddressPickerSheet } from '../../src/components/checkout/AddressPickerSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { SkeletonBlock } from '../../src/components/LoadingSkeleton';
import { PromoCards } from '../../src/components/commerce/PromoCards';
import { formatMoney } from '../../src/lib/format';
import { goBackOrHome } from '../../src/lib/navigation';
import { addressesApi } from '../../src/api/notifications-api';
import { useAuthStore } from '../../src/stores/auth-store';
import { useLastAddressStore } from '../../src/stores/last-address-store';
import { useLastPaymentMethodStore } from '../../src/stores/last-payment-method-store';
import { openRazorpayWebCheckout } from '../../src/lib/razorpay-checkout';
import { softShadow } from '../../src/lib/shadows';

const BRAND = '#0B594C';
const BRAND_DARK = '#08483E';
const BRAND_TINT = 'rgba(11, 89, 76, 0.08)';
const INK = '#171A18';
const MUTED = '#6F6C63';
const SUBTLE = '#8C8A80';
const LINE = '#EFEAE1';
const SURFACE_MUTED = '#F3EDE3';
const DANGER = '#B42318';
/** Completed steps + savings figures. Deliberately lighter than BRAND. */
const GREEN = '#1F7A43';
/** Direct amber for the delivery-address glyph. */
const AMBER = '#B4612F';
const AMBER_TINT = '#F7E9DD';
const GREEN_TINT = '#E3EFE9';
/** Editorial hero copy, over the checkout artwork. */
const HERO_GREEN = '#094A3C';
/** Page background, and the hairline that draws each card. */
const PAGE = '#FFFFFF';
const CARD_BORDER = '#EDE7DC';

/**
 * Demo UPI/card is opt-in; live Razorpay checkout is enabled only in a native
 * build whose backend has the matching Razorpay credentials configured. On WEB
 * (and inside Expo Go, where the native SDK cannot load) the Razorpay flow
 * opens the same gateway in a browser sheet instead — the order, the intent
 * and the webhook state machine are identical, only the checkout surface
 * differs.
 */
const PAYMENTS_DEMO_ENABLED = process.env.EXPO_PUBLIC_PAYMENTS_DEMO === 'true';
/**
 * Live online payments are a server capability: the gateway key arrives in the
 * server's payment intent, so the client flag alone gates the UI. Never require
 * a public key id here — the client must not hold gateway credentials.
 */
const RAZORPAY_ENABLED = process.env.EXPO_PUBLIC_RAZORPAY_ENABLED === 'true';
const ONLINE_PAYMENTS_ENABLED = PAYMENTS_DEMO_ENABLED || RAZORPAY_ENABLED;

/**
 * Checkout — address + payment, over server-authoritative totals.
 *
 * Flow: the server cart is the source of every number on screen (the client
 * computes nothing). The customer confirms a delivery address, picks Cash on
 * Delivery or an online method, and places the order.
 *
 * Online payment honesty: placing the order creates the order + a PENDING
 * payment. Razorpay captures through its hosted native SDK; only a verified
 * provider webhook advances the order to confirmed.
 */
export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);
  const lastAddress = useLastAddressStore((state) => state.address);
  const rememberAddress = useLastAddressStore((state) => state.remember);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The Payment Method options render expanded so UPI/Card/COD are
   * immediately visible without an extra tap. */
  const [paymentOpen, setPaymentOpen] = useState(true);
  const [method, setMethod] = useState<'COD' | OnlinePaymentMethod>(() => {
    const saved = useLastPaymentMethodStore.getState().method;
    return saved === 'UPI' || saved === 'CARD' || saved === 'NET_BANKING' ? saved : 'COD';
  });
  const [placing, setPlacing] = useState(false);
  /** Inline online-payment failure (stays on checkout; never an Alert). */
  const [paymentError, setPaymentError] = useState<string | null>(null);
  /**
   * The order created by this checkout attempt. Tapping Pay Now again reuses
   * it and only creates a fresh payment intent — `placeOrder` runs once per
   * checkout so a retry can never double-place.
   */
  const createdOrderRef = useRef<OrderResponse | null>(null);
  /** Idempotency keys: one per order attempt, one per payment-intent attempt. */
  const orderKeyRef = useRef<string | null>(null);
  const intentKeyRef = useRef<string | null>(null);
  /**
   * Placement failures render INLINE above the action: RNW's Alert.alert is a
   * no-op, so an alert-only error leaves a web customer tapping a button that
   * silently does nothing.
   */
  const [orderError, setOrderError] = useState<string | null>(null);

  /*
   * DEMO PAYMENT SHEET — for online methods the flow goes: place order →
   * create the payment intent → open the demo sheet → simulate the provider
   * outcome through the REAL webhook state machine → poll the server's
   * payment row until it resolves. The UI never claims success on its own.
   */
  const [pendingPayment, setPendingPayment] = useState<PaymentDetail | null>(null);

  /**
   * Prefill for the manual-entry sheet. Normally null (last-used address
   * applies); set when editing a saved row from the picker, cleared on close.
   */
  const editPrefillRef = useRef<CheckoutAddress | null>(null);
  const sheetInitial = editPrefillRef.current;

  const cart = useQuery({ queryKey: ['cart'], queryFn: cartApi.getCart, staleTime: 15_000 });

  /**
   * The saved address book (loaded with the screen, not on picker open) —
   * used below to keep checkout in step with an address the customer already
   * picked on the CART card.
   */
  const book = useQuery({
    queryKey: ['addresses'],
    queryFn: addressesApi.list,
    enabled: session !== null,
    staleTime: 30_000,
  });

  /**
   * PRESELECT the cart-picked address.
   *
   * `lastAddress` is shared with the cart card, but it can be a manual entry
   * (not a saved row) or stale. When it EXACTLY matches a saved row (same
   * normalised pincode+phone+name+street as the picker's matcher), adopt the
   * SERVER row so the picker highlights it, the address book stays the single
   * source of truth, and checkout shows what the customer chose on the cart.
   * A manual last-address that matches nothing still applies as-is.
   */
  const matchedSaved = useMemo(() => {
    if (lastAddress === null) return null;
    const addresses = book.data?.addresses ?? [];
    const norm = (value: string): string => value.trim().toLowerCase();
    return (
      addresses.find(
        (saved) =>
          saved.pincode.replace(/\D/g, '') === lastAddress.postalCode.replace(/\D/g, '') &&
          saved.phone.replace(/\D/g, '').slice(-10) === lastAddress.phone.replace(/\D/g, '').slice(-10) &&
          norm(saved.recipientName) === norm(lastAddress.fullName) &&
          norm(saved.line1) === norm(lastAddress.line1),
      ) ?? null
    );
  }, [book.data, lastAddress]);

  const [address, setAddress] = useState<CheckoutAddress | null>(() => {
    if (lastAddress === null) return null;
    if (matchedSaved) {
      return {
        fullName: matchedSaved.recipientName,
        phone: matchedSaved.phone,
        line1: matchedSaved.line1,
        line2: matchedSaved.line2 ?? '',
        landmark: matchedSaved.landmark ?? '',
        city: matchedSaved.city,
        state: matchedSaved.state,
        postalCode: matchedSaved.pincode,
      };
    }
    return lastAddress;
  });

  // The book can ARRIVE after mount (async query). When it does and the
  // customer has not already confirmed a row in the picker this session, swap
  // the provisional last-address for its saved twin so the picker highlights
  // the right row without any extra tap.
  const pickerConfirmedRef = useRef(false);
  useEffect(() => {
    if (pickerConfirmedRef.current || matchedSaved === null) return;
    setAddress((current) => {
      if (current === null || current !== lastAddress) return current;
      return {
        fullName: matchedSaved.recipientName,
        phone: matchedSaved.phone,
        line1: matchedSaved.line1,
        line2: matchedSaved.line2 ?? '',
        landmark: matchedSaved.landmark ?? '',
        city: matchedSaved.city,
        state: matchedSaved.state,
        postalCode: matchedSaved.pincode,
      };
    });
  }, [matchedSaved, lastAddress]);

  const hasItems = (cart.data?.items.length ?? 0) > 0;

  /** Units in the cart (sum of quantities) — the reference's "(3 items)". */
  const itemCount = (cart.data?.items ?? []).reduce((sum, item) => sum + item.quantity, 0);

  /**
   * Delivery ETA — the REAL serviceability check for the chosen address's
   * pincode (server zone data; no decorative claims). Re-checked when the
   * address changes; a retry exists for transient failures.
   */
  const pincode = address?.postalCode.replace(/\D/g, '') ?? '';
  const delivery = useQuery({
    queryKey: ['serviceability', pincode],
    queryFn: () => journeyApi.checkServiceability(pincode),
    enabled: pincode.length === 6,
    staleTime: 60_000,
    retry: 1,
  });
  const recheckDelivery = useMutation({ mutationFn: () => journeyApi.checkServiceability(pincode) });

  const contactDefaults = useMemo(() => {
    // session.user is guarded: a malformed persisted session (partial JSON,
    // older shape) must not crash the whole checkout — prefill just degrades.
    if (session === null || session.user === undefined || session.user === null) return null;
    return {
      name: [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim(),
      phone: session.user.phone ?? '',
    };
  }, [session]);

  /** Post-order cart cleanup shared by the COD path and the demo sheet. */
  const clearCartAfterOrder = useCallback(() => {
    // The cart is not auto-cleared by checkout (intentional, server-side), so
    // a successful placement clears it client-side and refreshes the query.
    queryClient.setQueryData<CartResponse>(['cart'], (previous) =>
      previous === undefined
        ? previous
        : {
            ...previous,
            items: [],
            subtotalInPaise: toPaise(0),
            discountInPaise: toPaise(0),
            taxInPaise: toPaise(0),
            shippingInPaise: toPaise(0),
            totalInPaise: toPaise(0),
            coupon: null,
          } satisfies CartResponse,
    );
    void queryClient.invalidateQueries({ queryKey: ['cart'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  }, [queryClient]);

  async function handlePlaceOrder() {
    if (address === null || !hasItems || placing) return;

    setPlacing(true);
    setOrderError(null);
    setPaymentError(null);
    // Reuse the order from the first tap: a retry only mints a fresh payment
    // intent, it never places a second order. One order key per checkout
    // attempt (server idempotency returns the same order on network retry).
    if (orderKeyRef.current === null) orderKeyRef.current = newIdempotencyKey();

    try {
      let order = createdOrderRef.current;
      if (order === null) {
        order = await checkoutApi.placeOrder({
          idempotencyKey: orderKeyRef.current,
          shippingAddress: address,
          billingAddress: null,
          notes: null,
        });
        createdOrderRef.current = order;
      }

      rememberAddress(address);

      /*
       * COD is anchored by checkout itself (a PENDING MANUAL payment exists).
       * Online methods create a server-owned gateway intent. Demo builds use
       * the simulator; native release builds open Razorpay Checkout. Payment
       * status still comes only from the signed webhook.
       */
      if (method !== 'COD') {
        // Every intent attempt gets a fresh key; the REUSED order id above is
        // what keeps a Pay Now retry from double-placing.
        if (intentKeyRef.current === null) intentKeyRef.current = newIdempotencyKey();
        let response: Awaited<ReturnType<typeof checkoutApi.createPaymentIntent>>;
        try {
          response = await checkoutApi.createPaymentIntent({
            orderId: order.id,
            method,
            idempotencyKey: intentKeyRef.current,
          });
          intentKeyRef.current = newIdempotencyKey();
          useLastPaymentMethodStore.getState().remember(method);
        } catch (cause) {
          // Stay on checkout with an inline error: retry reuses the order
          // above, or the customer can switch to pay-on-delivery instead.
          const message =
            cause instanceof Error ? friendlyError(cause.message) : 'Please try again in a moment.';
          setPaymentError(message);
          return;
        }
        {
          const placedOrder = order;
          if (response.payment.provider === 'MOCK' && PAYMENTS_DEMO_ENABLED) {
            setPendingPayment(response.payment);
            return;
          }
          if (response.payment.provider !== 'RAZORPAY' || !RAZORPAY_ENABLED) {
            setPaymentError('Online payments are not enabled for this app build. Pay on delivery instead.');
            return;
          }

          const intent = response.intent;
          if (
            typeof intent.key !== 'string' ||
            typeof intent.order_id !== 'string' ||
            typeof intent.amount !== 'number' ||
            typeof intent.currency !== 'string'
          ) {
            setPaymentError('The payment service returned an invalid checkout order.');
            return;
          }

          try {
            await openRazorpayWebCheckout(
              {
                key: intent.key,
                orderId: intent.order_id,
                amountInPaise: intent.amount,
                currency: intent.currency,
                orderNumber: placedOrder.orderNumber,
              },
              {
                onSuccess: () => {
                  createdOrderRef.current = null;
                  clearCartAfterOrder();
                  router.replace({
                    pathname: '/(shop)/orders/[id]',
                    params: { id: placedOrder.id, justPlaced: '1' },
                  });
                },
                // The sheet closed without a result: stay on checkout. The
                // order already exists, so "Try payment again" reuses it.
                onDismiss: () =>
                  setPaymentError(
                    'The payment window closed before we got a result. Try payment again, or pay on delivery instead.',
                  ),
                onError: (error) => setPaymentError(friendlyError(error.message)),
              },
            );
          } catch (cause) {
            const message =
              cause instanceof Error ? friendlyError(cause.message) : 'Please try again in a moment.';
            setPaymentError(message);
          }
          // The order is saved either way; its detail screen offers a retry.
          return;
        }
      }

      // The cart is not auto-cleared by checkout (intentional, server-side);
      // clear it client-side and refresh (shared with the demo sheet path).
      useLastPaymentMethodStore.getState().remember('COD');
      createdOrderRef.current = null;
      clearCartAfterOrder();

      router.replace({
        pathname: '/(shop)/orders/[id]',
        params: { id: order.id, justPlaced: '1' },
      });
    } catch (cause) {
      const message =
        cause instanceof Error ? friendlyError(cause.message) : 'Please try again in a moment.';
      // Inline only — no dialog. A dialog would add a fourth tap (dismiss)
      // to the Add → Checkout → Pay Now budget.
      setOrderError(message);
    } finally {
      setPlacing(false);
    }
  }

  if (session === null) {
    // Route-level guard; kept as a hard stop in case of deep-linking.
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <RNText style={{ color: MUTED }}>Verify your phone to continue.</RNText>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: PAGE, paddingTop: insets.top }}>
      {/* Header strip: the farm photo bleeds out from under it, so the
          progress row and hero copy sit ON the artwork. */}
      <View className="relative">
        <CheckoutBackdrop topOffset={insets.top} />
        <CheckoutHeaderBar />
      </View>

      {cart.isPending ? (
        <View className="gap-3 px-4 pt-2">
          <SkeletonBlock className="h-24 w-full rounded-2xl" />
          <SkeletonBlock className="h-16 w-full rounded-2xl" />
          <SkeletonBlock className="h-32 w-full rounded-2xl" />
        </View>
      ) : cart.isError || !cart.data ? (
        <ErrorState
          title="Could not load your cart"
          message="We could not reach your cart just now. Check your connection and try again."
          onRetry={() => void cart.refetch()}
        />
      ) : !hasItems ? (
        <EmptyCart onBrowse={() => router.replace('/(shop)')} />
      ) : (
        <>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {/* Progress: Address → Delivery → Payment → Review. The states
                reflect REAL screen state — address chosen? ETA known?
                ordering in flight? */}
            <CheckoutProgress
              steps={[
                { label: 'Address', state: address !== null ? 'done' : 'current' },
                {
                  label: 'Delivery',
                  state:
                    address === null ? 'future' : delivery.data?.serviceable ? 'done' : 'current',
                },
                { label: 'Payment', state: address === null ? 'future' : 'current' },
                { label: 'Review', state: placing ? 'current' : 'future' },
              ]}
            />

            {/* Editorial hero — the checkout's own artwork carries the copy. */}
            <View className="px-5 pt-3 pb-1">
              <RNText
                className="font-serif text-[22px] leading-[27px] font-bold"
                style={{ color: HERO_GREEN }}
              >
                Almost there!
              </RNText>
              <RNText
                className="mt-1 max-w-[280px] text-[12.5px] leading-[17px] font-semibold"
                style={{ color: '#1D2A23' }}
              >
                Complete your order to get farm fresh goodness at your doorstep.
              </RNText>
            </View>

            {/* DELIVERY — ONE card. The top half is the address (tap to add
                or change), the bottom half is the live delivery status for
                that address. Previously these were TWO separate cards that
                both opened the same sheet, which read as a duplicate. */}
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                address === null ? 'Add delivery address' : 'Change delivery address'
              }
              className="mx-3 mt-2 overflow-hidden rounded-[14px] border bg-white active:opacity-85"
              style={{
                borderColor: address === null ? BRAND : CARD_BORDER,
                borderWidth: address === null ? 1.4 : 1,
                ...softShadow,
              }}
            >
              <View className="flex-row items-center gap-3 p-3.5">
                <View
                  className="h-[38px] w-[38px] items-center justify-center rounded-[11px]"
                  style={{ backgroundColor: AMBER_TINT }}
                >
                  <Ionicons name={address === null ? 'location-outline' : 'home'} size={19} color={AMBER} />
                </View>
                <View className="min-w-0 flex-1">
                  {address === null ? (
                    <>
                      <RNText className="text-[13.5px] font-bold" style={{ color: INK }}>
                        Add delivery address
                      </RNText>
                      <RNText className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>
                        Where should we deliver your order?
                      </RNText>
                    </>
                  ) : (
                    <>
                      <RNText className="text-[13.5px] font-bold" style={{ color: INK }} numberOfLines={1}>
                        {addressLabel(address)}
                      </RNText>
                      <RNText className="mt-0.5 text-[12px] leading-[16px]" style={{ color: MUTED }} numberOfLines={1}>
                        {addressLine(address)}
                      </RNText>
                    </>
                  )}
                </View>
                <View className="rounded-[11px] px-2.5 py-1.5" style={{ backgroundColor: GREEN_TINT }}>
                  <RNText className="text-[11.5px] font-bold" style={{ color: GREEN }}>
                    {address === null ? 'ADD' : 'Change'}
                  </RNText>
                </View>
              </View>

              {address !== null ? (
                <>
                  <View className="h-px" style={{ backgroundColor: LINE }} />
                  <View className="flex-row items-center gap-3 px-3.5 py-2.5">
                    {delivery.isPending ? (
                      <>
                        <Ionicons name="bicycle-outline" size={17} color={MUTED} />
                        <RNText className="min-w-0 flex-1 text-[11.5px]" style={{ color: MUTED }} numberOfLines={1}>
                          {`Checking delivery for ${address.postalCode}…`}
                        </RNText>
                      </>
                    ) : delivery.isError || recheckDelivery.isPending ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Retry delivery check"
                        onPress={() => recheckDelivery.mutate()}
                        className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70"
                      >
                        <Ionicons name="cloud-offline-outline" size={17} color={AMBER} />
                        <RNText className="min-w-0 flex-1 text-[11.5px] font-semibold" style={{ color: AMBER }}>
                          Could not check delivery — tap to retry
                        </RNText>
                        <Ionicons name="refresh" size={15} color={BRAND} />
                      </Pressable>
                    ) : delivery.data?.serviceable ? (
                      <>
                        <Ionicons name="bicycle" size={17} color={GREEN} />
                        <RNText className="min-w-0 flex-1 text-[11.5px] font-semibold" style={{ color: GREEN }} numberOfLines={1}>
                          {delivery.data.etaLabel ?? 'Standard delivery available'}
                        </RNText>
                      </>
                    ) : (
                      <>
                        <Ionicons name="location-outline" size={17} color={AMBER} />
                        <RNText className="min-w-0 flex-1 text-[11.5px] font-semibold" style={{ color: AMBER }} numberOfLines={1}>
                          {`Not serviceable at ${address.postalCode} yet — try another address`}
                        </RNText>
                      </>
                    )}
                  </View>
                </>
              ) : null}
            </Pressable>

            {/* Payment method — ONE row per the reference. Tapping it opens
                the COD / UPI / Card radios, which stay the source of truth. */}
            <DetailCard
              icon={method === 'COD' ? 'cash-outline' : 'card-outline'}
              iconColor={INK}
              iconBackground="#F1EEE6"
              badge={method === 'UPI' ? 'UPI' : undefined}
              title="Payment Method"
              primary={paymentCopy(method).title}
              secondary={paymentCopy(method).blurb}
              onPress={() => setPaymentOpen((value) => !value)}
              trailingIcon={paymentOpen ? 'chevron-up' : 'chevron-forward'}
              accessibilityLabel="Change payment method"
            >
              {paymentOpen ? (
                <View>
                  <View className="h-px" style={{ backgroundColor: LINE }} />
                  <MethodRow
                    selected={method === 'COD'}
                    onSelect={() => setMethod('COD')}
                    icon="cash-outline"
                    title="Cash on Delivery"
                    subtitle="Pay when your order arrives"
                  />
                  {ONLINE_PAYMENTS_ENABLED ? (
                    <>
                      <View className="h-px" style={{ backgroundColor: LINE }} />
                      <MethodRow
                        selected={method === 'UPI'}
                        onSelect={() => setMethod('UPI')}
                        icon="phone-portrait-outline"
                        title="UPI"
                        subtitle={PAYMENTS_DEMO_ENABLED ? 'Pay with any UPI app' : 'Pay securely with UPI'}
                        trailing={
                          PAYMENTS_DEMO_ENABLED ? (
                            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: SURFACE_MUTED }}>
                              <RNText className="text-[9.5px] font-bold" style={{ color: MUTED }}>
                                DEMO
                              </RNText>
                            </View>
                          ) : null
                        }
                      />
                      <View className="h-px" style={{ backgroundColor: LINE }} />
                      <MethodRow
                        selected={method === 'CARD'}
                        onSelect={() => setMethod('CARD')}
                        icon="card-outline"
                        title="Card"
                        subtitle="Credit / debit — Visa, Mastercard, RuPay"
                        trailing={
                          PAYMENTS_DEMO_ENABLED ? (
                            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: SURFACE_MUTED }}>
                              <RNText className="text-[9.5px] font-bold" style={{ color: MUTED }}>
                                DEMO
                              </RNText>
                            </View>
                          ) : null
                        }
                      />
                    </>
                  ) : null}
                </View>
              ) : null}
            </DetailCard>

            {/* SAVINGS CARDS — the two offers, with honest live state.
                Delivery rule and coupon come from the server's own totals;
                the cards only READ the cart, they never compute money. */}
            <View className="mx-3">
            <PromoCards
              subtotalInPaise={cart.data.subtotalInPaise}
              shippingInPaise={cart.data.shippingInPaise}
              couponCode={cart.data.coupon?.code ?? null}
              onPickCoupon={() => router.push('/(shop)/cart')}
            />
            </View>

            {/* Order items — what is actually being approved, from the server
                cart, WITH the product imagery. No client math. */}
            <View className="mx-3 mt-3.5">
              <View className="mb-2 flex-row items-center justify-between px-1">
                <RNText className="text-[14px] font-extrabold" style={{ color: INK }}>
                  {`Order items (${itemCount})`}
                </RNText>
                <Pressable
                  onPress={() => router.push('/(shop)/cart')}
                  accessibilityRole="button"
                  accessibilityLabel="Edit order items"
                  hitSlop={8}
                  className="active:opacity-60"
                >
                  <RNText className="text-[12.5px] font-bold" style={{ color: BRAND }}>
                    Edit
                  </RNText>
                </Pressable>
              </View>

              <View
                className="flex-row items-center gap-2.5 rounded-[14px] border bg-white p-2.5"
                style={{ borderColor: CARD_BORDER, ...softShadow }}
              >
                {cart.data.items.slice(0, 3).map((item) => (
                  <View
                    key={item.id}
                    className="items-center justify-center overflow-hidden rounded-[10px]"
                    style={{ backgroundColor: SURFACE_MUTED, height: 62, width: 62 }}
                  >
                    {item.productImageUrl !== null ? (
                      <ExpoImage
                        source={{ uri: item.productImageUrl }}
                        style={{ width: 62, height: 62 }}
                        contentFit="cover"
                        cachePolicy="disk"
                        recyclingKey={item.id}
                        accessibilityIgnoresInvertColors
                      />
                    ) : (
                      <Ionicons name="leaf-outline" size={20} color={SUBTLE} />
                    )}
                  </View>
                ))}

                <View className="flex-1 items-end">
                  <Pressable
                    onPress={() => router.push('/(shop)/cart')}
                    accessibilityRole="button"
                    accessibilityLabel="Review all items"
                    className="h-[34px] w-[34px] items-center justify-center rounded-full active:opacity-70"
                    style={{ backgroundColor: '#F4F1E9' }}
                  >
                    <Ionicons name="chevron-forward" size={16} color={INK} />
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Price details — the server cart's own numbers, verbatim. */}
            <View
              className="mx-3 mt-3 rounded-[14px] border bg-white px-3.5 py-3.5"
              style={{ borderColor: CARD_BORDER, ...softShadow }}
            >
              <RNText className="mb-2.5 text-[14px] font-extrabold" style={{ color: INK }}>
                Price Details
              </RNText>

              <View className="mb-1.5 flex-row items-center justify-between">
                <RNText className="text-[12.5px]" style={{ color: MUTED }}>
                  {`Items total (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`}
                </RNText>
                <RNText className="text-[12.5px] font-semibold" style={{ color: INK }}>
                  {formatMoney(cart.data.subtotalInPaise)}
                </RNText>
              </View>

              {cart.data.discountInPaise > 0 ? (
                <View className="mb-1.5 flex-row items-center justify-between">
                  <RNText className="text-[12.5px]" style={{ color: GREEN }}>
                    {cart.data.coupon !== null
                      ? `Discount (Coupon: ${cart.data.coupon.code})`
                      : 'Discount'}
                  </RNText>
                  <RNText className="text-[12.5px] font-semibold" style={{ color: GREEN }}>
                    {`−${formatMoney(cart.data.discountInPaise)}`}
                  </RNText>
                </View>
              ) : null}

              {/* Taxes are inclusive in the displayed prices — no tax row is
                  ever added. The fine print says so once, below the total. */}

              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1">
                  <RNText className="text-[12.5px]" style={{ color: MUTED }}>
                    Delivery charges
                  </RNText>
                  <Ionicons name="information-circle-outline" size={13} color={SUBTLE} />
                </View>

                {cart.data.shippingInPaise > 0 ? (
                  <RNText className="text-[12.5px] font-semibold" style={{ color: INK }}>
                    {formatMoney(cart.data.shippingInPaise)}
                  </RNText>
                ) : (
                  <RNText className="text-[12.5px] font-semibold" style={{ color: GREEN }}>
                    FREE
                  </RNText>
                )}
              </View>

              <View
                className="mt-2.5 flex-row items-center justify-between border-t pt-2.5"
                style={{ borderColor: LINE }}
              >
                <RNText className="text-[14.5px] font-extrabold" style={{ color: INK }}>
                  Total amount
                </RNText>
                <RNText className="text-[15.5px] font-extrabold" style={{ color: INK }}>
                  {formatMoney(cart.data.totalInPaise)}
                </RNText>
              </View>
              <RNText className="mt-2 text-[10.5px] leading-[14px]" style={{ color: SUBTLE }}>
                Prices are inclusive of all applicable taxes.
              </RNText>
            </View>
          </ScrollView>

          {/* Place-order bar — STATIC (not absolute) so the confirm button is
              ALWAYS visible: one brand action carrying the amount. */}
          <View
            className="border-t bg-white px-3 pt-2.5"
            style={{
              borderColor: LINE,
              paddingBottom: Math.max(insets.bottom, 10),
              boxShadow: '0px -4px 14px rgba(58, 53, 43, 0.07)',
              elevation: 12,
              zIndex: 20,
            }}
          >
            {orderError !== null ? (
              <RNText
                accessibilityLiveRegion="polite"
                className="mb-2 text-center text-[12.5px] font-semibold"
                style={{ color: DANGER }}
              >
                {orderError}
              </RNText>
            ) : null}
            {paymentError !== null ? (
              <View
                accessibilityLiveRegion="polite"
                className="mb-2 rounded-2xl border p-3"
                style={{ borderColor: '#F0C9C4', backgroundColor: '#FDEEEC' }}
              >
                <RNText className="text-center text-[12.5px] font-semibold" style={{ color: DANGER }}>
                  {paymentError}
                </RNText>
                <View className="mt-2 flex-row gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Try payment again"
                    onPress={() => void handlePlaceOrder()}
                    disabled={placing}
                    className="flex-1 items-center justify-center rounded-full py-2.5 active:opacity-80"
                    style={{ backgroundColor: BRAND, opacity: placing ? 0.6 : 1 }}
                  >
                    <RNText className="text-[13px] font-bold" style={{ color: '#FFFFFF' }}>
                      Try payment again
                    </RNText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Pay on delivery instead"
                    onPress={() => {
                      setPaymentError(null);
                      setMethod('COD');
                    }}
                    disabled={placing}
                    className="flex-1 items-center justify-center rounded-full border py-2.5 active:opacity-80"
                    style={{ borderColor: BRAND, opacity: placing ? 0.6 : 1 }}
                  >
                    <RNText className="text-[13px] font-bold" style={{ color: BRAND }}>
                      Pay on delivery instead
                    </RNText>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {/* The confirm button is ALWAYS tappable. Without an address it
                opens the address sheet instead of sitting inert — a disabled
                primary action read as "there is no button". */}
            <Pressable
              onPress={() => {
                if (placing) return;
                if (address === null) {
                  setSheetOpen(true);
                  return;
                }
                void handlePlaceOrder();
              }}
              disabled={placing}
              accessibilityRole="button"
              accessibilityLabel="Place order"
              accessibilityState={{ disabled: placing, busy: placing }}
              style={({ pressed }) => [
                styles.placeOrder,
                placing && styles.placeOrderDisabled,
                pressed && !placing && styles.placeOrderPressed,
              ]}
            >
              {placing ? (
                <RNText style={styles.placeOrderLabel}>Placing order…</RNText>
              ) : address === null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="location-outline" size={17} color="#FFFFFF" />
                  <RNText style={styles.placeOrderLabel}>Add Delivery Address</RNText>
                  <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <RNText style={styles.placeOrderLabel}>
                    {method === 'COD' ? 'Confirm Order · Pay on Delivery' : 'Pay Now'}
                  </RNText>
                  <RNText style={styles.placeOrderLabel}>{formatMoney(cart.data.totalInPaise)}</RNText>
                  <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
                </View>
              )}
            </Pressable>

            {/* Security reassurance. The demo-payment disclosure lives on the
                payment sheet itself, at the moment money would move. */}
            <View className="mt-2 flex-row items-center justify-center gap-1.5">
              <Ionicons name="shield-checkmark" size={12} color={GREEN} />
              <RNText className="text-[10.5px] font-semibold" style={{ color: MUTED }}>
                100% secure payment
              </RNText>
            </View>
          </View>

          {/* Address book picker (signed-in): saved addresses from the server. */}
          <AddressPickerSheet
            visible={pickerOpen}
            selected={address}
            onClose={() => setPickerOpen(false)}
            onConfirm={(picked) => {
              // An explicit picker confirm wins over the cart-derived match
              // for the rest of this visit.
              pickerConfirmedRef.current = true;
              setAddress(picked);
              rememberAddress(picked);
              setPickerOpen(false);
            }}
            onEdit={(prefill) => {
              setPickerOpen(false);
              setSheetOpen(true);
              editPrefillRef.current = prefill;
            }}
            onAddNew={() => {
              // Fresh entry: clear any edit prefill so the sheet opens EMPTY
              // (session name/phone still apply via contactDefaults).
              editPrefillRef.current = null;
              setPickerOpen(false);
              setSheetOpen(true);
            }}
          />

          {/* Manual entry / edit. `sheetInitial` wins over the last-used
              default so editing a saved row opens THAT row's data. */}
          <AddressSheet
            visible={sheetOpen}
            initial={sheetInitial}
            contactDefaults={contactDefaults}
            canSaveToBook
            onSave={(saved, saveToBook) => {
              // A manual save is an explicit customer choice too.
              pickerConfirmedRef.current = true;
              setAddress(saved);
              rememberAddress(saved);
              setSheetOpen(false);
              if (saveToBook) {
                // Visible outcome either way — a silent failure looks broken.
                void (async () => {
                  try {
                    await addressesApi.create({
                      recipientName: saved.fullName,
                      phone: saved.phone,
                      line1: saved.line1,
                      line2: saved.line2 === '' ? null : saved.line2,
                      landmark: saved.landmark === '' ? null : saved.landmark,
                      city: saved.city,
                      state: saved.state,
                      pincode: saved.postalCode,
                    });
                    void queryClient.invalidateQueries({ queryKey: ['addresses'] });
                  } catch {
                    Alert.alert(
                      'Address not saved to your address book',
                      'Your order will still deliver to this address. You can save it to your address book next time.',
                      [{ text: 'OK' }],
                    );
                  }
                })();
              }
            }}
            onClose={() => {
              setSheetOpen(false);
              editPrefillRef.current = null;
            }}
          />

          {/* DEMO PAYMENT SHEET — demo builds only; unreachable otherwise
              because no online method can be selected. Drives the provider
              outcome through the real state machine, navigating on polled
              state rather than a client claim. */}
          {PAYMENTS_DEMO_ENABLED && pendingPayment !== null ? (
            <DemoPaymentSheet
              payment={pendingPayment}
              onDone={(result) => {
                const orderId = pendingPayment.orderId;
                setPendingPayment(null);
                if (result === 'captured') {
                  clearCartAfterOrder();
                }
                router.replace({
                  pathname: '/(shop)/orders/[id]',
                  params: { id: orderId, justPlaced: '1' },
                });
              }}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* DEMO PAYMENT SHEET                                                  */
/* ------------------------------------------------------------------ */

/**
 * Demo payment processing sheet.
 *
 * The honest mock: mounting simulates the provider's answer through the
 * server's webhook state machine (POST /payments/:id/simulate), then the
 * sheet POLLS the order's payment rows — it never declares success on its
 * own authority. There is deliberately NO confirm phase: Pay Now on checkout
 * already IS the confirmation, and an extra "Pay now" inside the sheet would
 * push the purchase to 4 taps (Add → Checkout → Pay Now → Pay now).
 * Failure offers retry (a fresh simulate round) or leaving it pending for
 * the order screen. Cards/UPI are labelled demo because they ARE demo.
 */
function DemoPaymentSheet({
  payment,
  onDone,
}: {
  payment: PaymentDetail;
  onDone: (result: 'captured' | 'pending' | 'failed') => void;
}) {
  const [phase, setPhase] = useState<'processing' | 'failed'>('processing');
  const startedRef = useRef(false);

  // Auto-start the simulated provider round on mount: Pay Now on checkout was
  // already the confirmation, so no second "Pay now" tap lives in this sheet.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void simulate('success');
  }, []);
  const [simulateError, setSimulateError] = useState<string | null>(null);

  async function simulate(outcome: 'success' | 'failure') {
    setPhase('processing');
    setSimulateError(null);
    try {
      await checkoutApi.simulatePayment({ paymentId: payment.id, outcome });
      // Confirm via the server, not the simulate response alone.
      const attempts = await checkoutApi.listPayments(payment.orderId);
      const current = attempts.find((attempt) => attempt.id === payment.id) ?? payment;
      if (current.status === 'CAPTURED') {
        onDone('captured');
      } else if (current.status === 'FAILED') {
        setPhase('failed');
      } else {
        onDone('pending');
      }
    } catch {
      // Inline + stay on the sheet: the order is saved, "Try again" retries
      // the simulate round, "Pay on delivery instead" parks it as pending.
      setSimulateError('We could not reach the payment service. Try again.');
      setPhase('failed');
    }
  }

  function cancel() {
    onDone('pending');
  }

  return (
    <Modal transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={cancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(23,26,24,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
        <View style={{ width: '100%', maxWidth: 360, borderRadius: 20, backgroundColor: '#FFFFFF', padding: 22 }}>
          <View style={{ alignItems: 'center' }}>
            <View style={{ height: 46, width: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF7ED' }}>
              <Ionicons name={payment.method === 'CARD' ? 'card-outline' : 'phone-portrait-outline'} size={22} color={BRAND} />
            </View>
            <RNText className="text-[16px] font-bold mt-2.5" style={{ color: INK }}>
              Pay {formatMoney(payment.amountInPaise)}
            </RNText>
            <RNText className="text-[12px] mt-1 text-center" style={{ color: MUTED }}>
              {payment.method === 'CARD' ? 'Card' : 'UPI'} · Demo checkout — no real money moves
            </RNText>
          </View>

          {phase === 'processing' ? (
            <View style={{ alignItems: 'center', marginTop: 18, gap: 8 }}>
              <Ionicons name="sync-circle-outline" size={30} color={BRAND} />
              <RNText className="text-[13px]" style={{ color: MUTED }}>
                Processing payment…
              </RNText>
            </View>
          ) : phase === 'failed' ? (
            <View style={{ alignItems: 'center', marginTop: 16, gap: 6 }}>
              <Ionicons name="alert-circle-outline" size={30} color={DANGER} />
              <RNText className="text-[14px] font-bold" style={{ color: INK }}>
                Payment declined
              </RNText>
              <RNText className="text-[12px] text-center" style={{ color: MUTED }}>
                {simulateError ?? 'The demo provider declined this payment. Your order is saved.'}
              </RNText>
              <Pressable
                onPress={() => void simulate('success')}
                accessibilityRole="button"
                accessibilityLabel="Try payment again"
                className="h-[44px] rounded-full bg-brand items-center justify-center mt-2 w-full"
              >
                <RNText className="text-white text-[14px] font-bold">Try payment again</RNText>
              </Pressable>
              <Pressable
                onPress={cancel}
                accessibilityRole="button"
                accessibilityLabel="Pay on delivery instead"
                className="h-[40px] items-center justify-center w-full"
              >
                <RNText className="text-[13px] font-semibold" style={{ color: MUTED }}>
                  Pay on delivery instead
                </RNText>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

/* ===========================================================================
   HEADER ARTWORK

   The checkout's own farm photo, pinned under the white header strip and
   feathered into the page: a vertical wash keeps the step labels readable at
   the top and melts the picture into the cards below, and a horizontal one
   holds contrast under the serif hero copy.
   =========================================================================== */

function CheckoutBackdrop({ topOffset }: { topOffset: number }) {
  return (
    <View
      pointerEvents="none"
      className="absolute left-0 right-0 h-[250px]"
      style={{ top: -topOffset }}
    >
      <ExpoImage
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../src/images/checkout-header.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        accessibilityIgnoresInvertColors
      />

      {/* Light frost under the fixed chrome — the photo keeps its texture
          while the step labels stay readable at the top. */}
      <BlurView
        pointerEvents="none"
        intensity={28}
        tint="light"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72 }}
      />

      {/* Vertical: readable top → the picture → the page. */}
      <LinearGradient
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        colors={[
          'rgba(255,255,255,0.52)',
          'rgba(255,255,255,0.06)',
          'rgba(255,255,255,0)',
          'rgba(255,255,255,0.72)',
          '#FFFFFF',
        ]}
        locations={[0, 0.2, 0.46, 0.72, 0.9]}
        style={StyleSheet.absoluteFill}
      />

      {/* Horizontal: calm the left edge under the hero copy. */}
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 0.7, y: 0.5 }}
        colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/* ===========================================================================
   HEADER ROW — flat dark icons on white, title centred
   =========================================================================== */

function CheckoutHeaderBar() {
  return (
    <View className="h-12 flex-row items-center px-2">
      <View className="w-[72px] flex-row items-center">
        <Pressable
          onPress={goBackOrHome}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          className="h-[38px] w-[38px] items-center justify-center active:opacity-60"
        >
          <Ionicons name="chevron-back" size={23} color={INK} />
        </Pressable>
      </View>

      <View className="flex-1 items-center">
        <RNText className="text-[16.5px] font-bold tracking-[-0.1px]" style={{ color: INK }}>
          Checkout
        </RNText>
      </View>

      <View className="w-[72px] flex-row items-center justify-end">
        <Pressable
          onPress={() => router.push('/search')}
          accessibilityRole="button"
          accessibilityLabel="Search products"
          hitSlop={6}
          className="h-[38px] w-[34px] items-center justify-center active:opacity-60"
        >
          <Ionicons name="search-outline" size={20} color={INK} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/(shop)/cart')}
          accessibilityRole="button"
          accessibilityLabel="View cart"
          hitSlop={6}
          className="h-[38px] w-[34px] items-center justify-center active:opacity-60"
        >
          <Ionicons name="bag-handle-outline" size={20} color={INK} />
        </Pressable>
      </View>
    </View>
  );
}

/* ===========================================================================
   PROGRESS — Address → Delivery → Payment → Review

   Every state is real screen state: done = green check, current = green
   number, future = muted outline. The connector behind completed steps turns
   green so the sequence reads at a glance over the artwork.
   =========================================================================== */

function CheckoutProgress({
  steps,
}: {
  steps: readonly { label: string; state: 'done' | 'current' | 'future' }[];
}) {
  return (
    <View className="flex-row items-start px-4 pt-2.5" pointerEvents="none">
      {steps.map((step, index) => (
        <Fragment key={step.label}>
          {index > 0 ? (
            <View
              style={[
                styles.progressLine,
                steps[index - 1]?.state === 'done' ? styles.progressLineDone : null,
              ]}
            />
          ) : null}

          <View style={styles.progressStep}>
            <View
              style={[
                styles.progressDot,
                step.state === 'done' ? styles.progressDotDone : null,
                step.state === 'current' ? styles.progressDotCurrent : null,
                step.state === 'future' ? styles.progressDotFuture : null,
              ]}
            >
              {step.state === 'done' ? (
                <Ionicons name="checkmark" size={13} color="#FFFFFF" />
              ) : (
                <RNText
                  style={[
                    styles.progressIndex,
                    step.state === 'current' ? styles.progressIndexCurrent : null,
                  ]}
                >
                  {index + 1}
                </RNText>
              )}
            </View>

            <RNText
              style={[
                styles.progressLabel,
                step.state === 'future' ? styles.progressLabelFuture : null,
              ]}
            >
              {step.label}
            </RNText>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

/* ===========================================================================
   DETAIL CARD — icon tile + title + two-line detail + chevron

   The checkout's one row shape (address, delivery, payment). `badge` swaps
   the icon glyph for short text (the UPI mark); `children` renders below the
   row inside the same card, which is how the payment radios expand.
   =========================================================================== */

function DetailCard({
  icon,
  iconColor,
  iconBackground,
  badge,
  title,
  primary,
  secondary,
  onPress,
  accessibilityLabel,
  trailingIcon = 'chevron-forward',
  trailingColor = SUBTLE,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBackground: string;
  badge?: string;
  title: string;
  primary?: string;
  secondary?: string;
  onPress?: () => void;
  accessibilityLabel: string;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  trailingColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <View
      className="mx-3 mt-3 overflow-hidden rounded-[14px] border bg-white"
      style={{ borderColor: CARD_BORDER, ...softShadow }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        className="flex-row items-center gap-3 p-3.5 active:opacity-85"
      >
        <View
          className="h-[38px] w-[38px] items-center justify-center rounded-full"
          style={{ backgroundColor: iconBackground }}
        >
          {badge !== undefined ? (
            <RNText className="text-[10px] font-extrabold" style={{ color: iconColor }}>
              {badge}
            </RNText>
          ) : (
            <Ionicons name={icon} size={19} color={iconColor} />
          )}
        </View>

        <View className="min-w-0 flex-1">
          <RNText className="text-[13.5px] font-bold" style={{ color: INK }}>
            {title}
          </RNText>
          {primary !== undefined ? (
            <RNText className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
              {primary}
            </RNText>
          ) : null}
          {secondary !== undefined ? (
            <RNText className="text-[11.5px] leading-[15px]" style={{ color: SUBTLE }}>
              {secondary}
            </RNText>
          ) : null}
        </View>

        <Ionicons name={trailingIcon} size={17} color={trailingColor} />
      </Pressable>

      {children}
    </View>
  );
}

/** Copy for the collapsed Payment Method row (mirrors the method radios). */
function paymentCopy(method: 'COD' | OnlinePaymentMethod): { title: string; blurb: string } {
  if (method === 'COD') {
    return { title: 'Cash on Delivery', blurb: 'Pay when your order arrives' };
  }
  if (method === 'UPI') {
    return { title: 'UPI', blurb: 'GPay, PhonePe, Paytm & all UPI apps' };
  }
  return { title: 'Card', blurb: 'Credit / debit card — Visa, Mastercard, RuPay' };
}

function MethodRow({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
  trailing,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      className="flex-row items-center gap-3 p-3.5"
      // Selected row gets the brand-tint wash — the navbar active-capsule
      // recipe — so the choice reads at a glance without heavy borders.
      style={selected ? { backgroundColor: BRAND_TINT } : null}
    >
      <View
        className="h-[34px] w-[34px] items-center justify-center rounded-full"
        style={{ backgroundColor: selected ? BRAND : SURFACE_MUTED }}
      >
        <Ionicons name={icon} size={17} color={selected ? '#FFFFFF' : INK} />
      </View>
      <View className="flex-1">
        <RNText className="text-[13.5px] font-bold" style={{ color: INK }}>
          {title}
        </RNText>
        <RNText className="text-[11.5px]" style={{ color: MUTED }}>
          {subtitle}
        </RNText>
      </View>
      {trailing}
      <View
        className="h-5 w-5 items-center justify-center rounded-full border-2"
        style={{ borderColor: selected ? BRAND : LINE }}
      >
        {selected ? <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND }} /> : null}
      </View>
    </Pressable>
  );
}

function EmptyCart({ onBrowse }: { onBrowse: () => void }) {
  return (
    <EmptyState
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      image={require('../../src/assets/empty-cart.png')}
      title="Your cart is empty"
      message="Add something fresh and come back to check out."
      ctaLabel="Browse products"
      onCta={onBrowse}
    />
  );
}


/**
 * Single-line rendering of the delivery card.
 *
 * Reads like the delivery apps: "Home · #233, 1st cross, …" — the customer's
 * own words lead, the city/state collapse into the tail, and the pincode is
 * always visible last. The full detail is one tap away via Change.
 */
function addressLine(address: CheckoutAddress): string {
  const street = [address.line1, address.line2 ?? '', address.landmark ?? '']
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ');
  const tail = [address.city, address.state].map((part) => part.trim()).filter((part) => part !== '');
  return [street, ...tail, address.postalCode.replace(/\D/g, '')].filter(Boolean).join(', ');
}

/**
 * Short card title like "Home · #233 1st Cross" — a tag (derived from who
 * the address is for / what it contains) plus the first few words of the
 * street. The full address lives in `addressLine` below it.
 */
function addressLabel(address: CheckoutAddress): string {
  const street = address.line1.trim();
  const shortStreet = street.split(/\s+/).slice(0, 4).join(' ');
  const tag = /office|work/i.test(street)
    ? 'Office'
    : /flat|apt|apartment/i.test(street)
      ? 'Flat'
      : 'Home';
  return `${tag} · ${shortStreet}`;
}

const styles = StyleSheet.create({
  /* ── Progress over the artwork ──────────────────────────────────────── */

  progressLine: {
    // Sits on the dot's centre line: the step column is dot + label tall.
    alignSelf: 'flex-start',
    backgroundColor: '#D9DED6',
    flex: 1,
    height: 1.5,
    marginTop: 10,
  },

  progressLineDone: {
    backgroundColor: 'rgba(31, 122, 67, 0.5)',
  },

  progressStep: {
    alignItems: 'center',
    width: 62,
  },

  progressDot: {
    alignItems: 'center',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },

  progressDotDone: {
    backgroundColor: GREEN,
  },

  progressDotCurrent: {
    backgroundColor: GREEN,
  },

  progressDotFuture: {
    backgroundColor: '#FFFFFF',
    borderColor: '#C6CEC3',
    borderWidth: 1.5,
  },

  progressIndex: {
    color: SUBTLE,
    fontSize: 10.5,
    fontWeight: '800',
  },

  progressIndexCurrent: {
    color: '#FFFFFF',
  },

  progressLabel: {
    color: '#2F3830',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
  },

  progressLabelFuture: {
    color: SUBTLE,
  },

  /* ── Place-order bar — the cart CTA vocabulary ───────────────────────── */

  /** One brand action per screen, matching the cart's CTA vocabulary. */
  placeOrder: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    backgroundColor: BRAND,
    paddingHorizontal: 24,
  },
  placeOrderPressed: {
    backgroundColor: BRAND_DARK,
    transform: [{ scale: 0.985 }],
  },
  placeOrderDisabled: {
    opacity: 0.55,
  },
  placeOrderLabel: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

/** Map transport/service failures to what a customer should read. */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('empty cart')) {
    return 'Your cart changed before the order was placed. Please review it and try again.';
  }
  if (lower.includes('store')) {
    return 'This order cannot be fulfilled right now. Please try again shortly.';
  }
  // The server's delivery rejections are already customer-actionable copy
  // ("we do not deliver to this pincode yet") — pass them through untouched.
  if (lower.includes('pincode') || lower.includes('deliver')) {
    return raw;
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('aborted')) {
    return 'Unable to connect. Please check your connection and try again.';
  }
  return 'Could not place the order. Please try again in a moment.';
}
