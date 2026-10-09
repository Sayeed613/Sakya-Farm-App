import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
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
import { containsFreshProduce as cartHasFreshProduce, toPaise } from '@sakya/utils';
import { ErrorState } from '../../src/components/ErrorState';
import { SkeletonBlock } from '../../src/components/LoadingSkeleton';
import { formatMoney } from '../../src/lib/format';
import { goBackOrHome } from '../../src/lib/navigation';
import { addressesApi } from '../../src/api/notifications-api';
import { useAuthStore } from '../../src/stores/auth-store';
import { useLastAddressStore } from '../../src/stores/last-address-store';
import { useLastPaymentMethodStore } from '../../src/stores/last-payment-method-store';
import { resolveInitialPaymentMethod } from '../../src/lib/payment-restore';
import { openRazorpayWebCheckout, reserveRazorpayPopup } from '../../src/lib/razorpay-checkout';
import { softShadow } from '../../src/lib/shadows';

import AddressSelection from './components/AddressSelection';
import ApplyCouponCard from './components/ApplyCouponCard';
import PaymentMethodSelection from './components/PaymentMethodSelection';
import OrderReview from './components/OrderReview';
import CheckoutProgress from './components/CheckoutProgress';
import {
  addressLabel,
  addressLine,
  sameAddress,
  savedRowToAddress,
} from '../../src/lib/addressHelpers';
import EmptyCart from './components/EmptyCart';

const BRAND = '#0B594C';
const BRAND_DARK = '#08483E';
const INK = '#171A18';
const MUTED = '#6F6C63';
const SUBTLE = '#8C8A80';
const LINE = '#EFEAE1';
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
 * server's payment intent, so the client flag alone gates the UI. The client
 * must not hold gateway credentials — the public key id is never required.
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
  const [addressBookError, setAddressBookError] = useState<string | null>(null);

  /*
   * DEMO PAYMENT SHEET — for online methods the flow goes: place order →
   * create the payment intent → open the demo sheet → simulate the provider
   * outcome through the REAL webhook state machine → poll the server's
   * payment row until it resolves. The UI never claims success on its own.
   */
  const [pendingPayment, setPendingPayment] = useState<PaymentDetail | null>(null);

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
    // PURE adoption: the store is synced in the effect below, never during
    // render — a Zustand `set` here would update HomeHeader while
    // CheckoutScreen is rendering (and, because the effect rebuilt the
    // object each pass, loop until "Maximum update depth exceeded").
    if (matchedSaved) return savedRowToAddress(matchedSaved);
    return lastAddress;
  });

  /** True once the customer explicitly picked or saved an address this visit. */
  const pickerConfirmedRef = useRef(false);

  // The book can ARRIVE after mount (async query). When it does and the
  // customer has not already confirmed a row in the picker this session, swap
  // the provisional last-address for its saved twin so the picker highlights
  // the right row without any extra tap.
  useEffect(() => {
    if (pickerConfirmedRef.current || matchedSaved === null || lastAddress === null) return;
    const adopted = savedRowToAddress(matchedSaved);
    // Only act while the VISIBLE address is still derived from the stored
    // last-address (the raw value or its adopted saved twin) — never
    // something the customer entered themselves this visit.
    if (address === null || (address !== lastAddress && !sameAddress(address, adopted))) return;
    // Value-equality guards make this effect convergent: once the store and
    // the form both hold the adopted twin, both calls below are no-ops, no
    // state identity changes, and the effect stops re-firing.
    if (!sameAddress(lastAddress, adopted)) rememberAddress(adopted);
    if (!sameAddress(address, adopted)) setAddress(adopted);
  }, [matchedSaved, lastAddress, address, pickerConfirmedRef]);

  useEffect(() => {
    if (pickerConfirmedRef.current || lastAddress !== null || address !== null || book.data === undefined) {
      return;
    }
    const saved = book.data.addresses.find((candidate) => candidate.isDefault) ?? book.data.addresses[0];
    if (saved === undefined) return;
    setAddress({
      fullName: saved.recipientName,
      phone: saved.phone,
      line1: saved.line1,
      line2: saved.line2 ?? '',
      landmark: saved.landmark ?? '',
      city: saved.city,
      state: saved.state,
      postalCode: saved.pincode,
    });
  }, [address, book.data, lastAddress]);

  const hasItems = (cart.data?.items.length ?? 0) > 0;

  /** Units in the cart (sum of quantities) — the reference's "(3 items)". */
  const itemCount = (cart.data?.items ?? []).reduce((sum, item) => sum + item.quantity, 0);

  /**
   * Delivery ETA — the REAL serviceability check for the chosen address's
   * pincode (server zone data; no decorative claims). Re-checked when the
   * address changes; a retry exists for transient failures.
   */
  const pincode = address?.postalCode.replace(/\D/g, '') ?? '';
  const containsFreshProduce = (cart.data?.items ?? []).some((item) =>
    cartHasFreshProduce(item.categorySlugs ?? []),
  );
  const delivery = useQuery({
    queryKey: ['serviceability', pincode, containsFreshProduce],
    queryFn: () => journeyApi.checkServiceability(pincode, containsFreshProduce),
    enabled: pincode.length === 6 && cart.data !== undefined,
    staleTime: 60_000,
    retry: 1,
  });
  const recheckDelivery = useMutation({
    mutationFn: () => journeyApi.checkServiceability(pincode, containsFreshProduce),
  });

  /**
   * Persist a manual address to the server book. Errors PROPAGATE:
   * AddressSelection turns a failure into a visible alert while the order
   * still ships to the address that was entered.
   */
  const saveAddressToBook = useCallback(
    async (saved: CheckoutAddress) => {
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
    },
    [queryClient],
  );

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

    const needsRazorpayPopup =
      Platform.OS === 'web' && method !== 'COD' && RAZORPAY_ENABLED && !PAYMENTS_DEMO_ENABLED;
    const reservedPopup = needsRazorpayPopup ? reserveRazorpayPopup(method) : null;
    if (needsRazorpayPopup && reservedPopup === null) {
      setPaymentError('Allow pop-ups for Sakya Farms to continue to secure payment.');
      return;
    }
    let popupHandedOff = false;

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
                method,
                reservedPopup: reservedPopup ?? undefined,
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
            popupHandedOff = true;
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
      if (reservedPopup !== null && !popupHandedOff && !reservedPopup.closed) {
        reservedPopup.close();
      }
      setPlacing(false);
    }
  }

  const [method, setMethod] = useState<'COD' | OnlinePaymentMethod>(() =>
    // A remembered online method must NOT become active while online
    // payments are disabled (its tiles are hidden then) — see
    // resolveInitialPaymentMethod for the flag matrix.
    resolveInitialPaymentMethod(
      useLastPaymentMethodStore.getState().method,
      ONLINE_PAYMENTS_ENABLED,
    ),
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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

            {/* Address Selection */}
            <AddressSelection
              address={address}
              pickerOpen={pickerOpen}
              sheetOpen={sheetOpen}
              onPickerOpenChange={setPickerOpen}
              onSheetOpenChange={setSheetOpen}
              onAddressChange={(picked) => {
                // A manual save is an explicit choice — it wins over the
                // cart-derived match for the rest of this visit.
                pickerConfirmedRef.current = true;
                setAddressBookError(null);
                setAddress(picked);
                // `picked` can theoretically be null (clear); the store only
                // persists a real address.
                if (picked !== null) rememberAddress(picked);
              }}
              onAddressConfirm={(picked) => {
                pickerConfirmedRef.current = true;
                setAddress(picked);
                rememberAddress(picked);
              }}
              onSaveToAddressBook={saveAddressToBook}
              onAddressBookSaveStatus={setAddressBookError}
            />
            {addressBookError !== null ? (
              <RNText className="mx-4 mt-2 text-[11.5px] leading-4" style={{ color: DANGER }}>
                {addressBookError}
              </RNText>
            ) : null}

            {/* Delivery — ONE card. The top half is the address (tap to add
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
            <PaymentMethodSelection
              method={method}
              onMethodChange={setMethod}
              isOnlinePaymentsEnabled={ONLINE_PAYMENTS_ENABLED}
            />

            {/* APPLY COUPON — explicit Apply, applied state with Remove,
                server-authoritative totals. CouponBox writes the returned
                cart into the ['cart'] cache, so Price Details and the
                place-order amount update the moment the server accepts.
                `forceOpen` shows the pre-selected code on arrival: the
                customer sees SAKYA100 ready, taps Apply, and the server's
                confirmation (the applied state) is the confirm step. */}
            <View className="mx-3">
              <ApplyCouponCard
                coupon={cart.data.coupon ?? null}
                subtotalInPaise={cart.data.subtotalInPaise}
                forceOpen
              />
            </View>

            {/* Order Review */}
            <OrderReview
              cart={cart.data}
              itemCount={itemCount}
              onEditCart={() => router.push('/(shop)/cart')}
            />
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

/* This component has been moved to ./components/CheckoutProgress.tsx */

/* ===========================================================================
   DETAIL CARD — icon tile + title + two-line detail + chevron

   The checkout's one row shape (address, delivery, payment). `badge` swaps
   the icon glyph for short text (the UPI mark); `children` renders below the
   row inside the same card, which is how the payment radios expand.
   =========================================================================== */

/* This component has been moved to ./components/DetailCard.tsx */

/* ===========================================================================
   COPY FOR THE COLLAPSED PAYMENT METHOD ROW (mirrors the method radios).
   =========================================================================== */

/* This function has been moved to src/lib/paymentCopy.ts */

/* ===========================================================================
   METHOD ROW — removed: the payment choices are now three side-by-side
   tiles inside PaymentMethodSelection.tsx (no stacked radio rows).
   =========================================================================== */


/* ===========================================================================
   ADDRESS LINE AND LABEL HELPERS
   =========================================================================== */

/* These functions have been moved to src/lib/addressHelpers.ts */

/* ===========================================================================
   STYLES
   =========================================================================== */

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