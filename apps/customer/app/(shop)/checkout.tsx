import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cartApi } from '../../src/api/cart';
import {
  checkoutApi,
  newIdempotencyKey,
  type CheckoutAddress,
  type OnlinePaymentMethod,
} from '../../src/api/checkout';
import type { CartResponse, PaymentDetail } from '@sakya/types';
import { toPaise } from '@sakya/utils';
import { AddressSheet } from '../../src/components/checkout/AddressSheet';
import { AddressPickerSheet } from '../../src/components/checkout/AddressPickerSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { SkeletonBlock } from '../../src/components/LoadingSkeleton';
import { formatMoney } from '../../src/lib/format';
import { addressesApi } from '../../src/api/notifications-api';
import { useAuthStore } from '../../src/stores/auth-store';
import { useLastAddressStore } from '../../src/stores/last-address-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const SURFACE_MUTED = '#F3EDE3';
const DANGER = '#B42318';

/**
 * Checkout — address + payment, over server-authoritative totals.
 *
 * Flow: the server cart is the source of every number on screen (the client
 * computes nothing). The customer confirms a delivery address, picks Cash on
 * Delivery or an online method, and places the order.
 *
 * Online payment honesty: placing the order creates the order + a PENDING
 * payment. Choosing an online method then creates a payment INTENT. The app
 * polls the order's payments afterwards — capture happens via the provider's
 * webhook, and the UI never claims "paid" on its own say-so. In this build the
 * only configured provider is the dev MOCK adapter, so the intent flow works
 * end-to-end against the real webhook path in non-production.
 */
export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);
  const lastAddress = useLastAddressStore((state) => state.address);
  const rememberAddress = useLastAddressStore((state) => state.remember);

  const [address, setAddress] = useState<CheckoutAddress | null>(lastAddress);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [method, setMethod] = useState<'COD' | OnlinePaymentMethod>('COD');
  const [placing, setPlacing] = useState(false);

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

  const hasItems = (cart.data?.items.length ?? 0) > 0;

  const contactDefaults = useMemo(() => {
    if (session === null) return null;
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
    // One key per attempt: a retry after a network failure returns the same
    // order instead of creating a second one (server-side idempotency).
    const idempotencyKey = newIdempotencyKey();

    try {
      const order = await checkoutApi.placeOrder({
        idempotencyKey,
        shippingAddress: address,
        billingAddress: null,
        notes: null,
      });

      rememberAddress(address);

      /*
       * COD is anchored by checkout itself (a PENDING MANUAL payment exists).
       * Online methods: create the intent, then hand the PENDING payment to
       * the demo sheet, which drives the provider outcome and navigates on
       * the POLLED server state. A failed intent still lands on the order —
       * payment can be retried from the order screen.
       */
      if (method !== 'COD') {
        try {
          const { payment } = await checkoutApi.createPaymentIntent({
            orderId: order.id,
            method,
            idempotencyKey: newIdempotencyKey(),
          });
          setPendingPayment(payment);
          // Checkout ends here; the demo sheet owns the rest of the journey.
          return;
        } catch {
          // The order exists either way — land on it; retry lives there.
          router.replace({
            pathname: '/(shop)/orders/[id]',
            params: { id: order.id, justPlaced: '1' },
          });
          return;
        }
      }

      // The cart is not auto-cleared by checkout (intentional, server-side);
      // clear it client-side and refresh (shared with the demo sheet path).
      clearCartAfterOrder();

      router.replace({
        pathname: '/(shop)/orders/[id]',
        params: { id: order.id, justPlaced: '1' },
      });
    } catch (cause) {
      Alert.alert(
        'Could not place order',
        cause instanceof Error ? friendlyError(cause.message) : 'Please try again in a moment.',
        [{ text: 'OK' }],
      );
    } finally {
      setPlacing(false);
    }
  }

  if (session === null) {
    // Route-level guard; kept as a hard stop in case of deep-linking.
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#FAF7F0' }}>
        <RNText style={{ color: MUTED }}>Verify your phone to continue.</RNText>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: '#FAF7F0', paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center gap-1 px-3 pb-2 pt-2">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          className="h-9 w-9 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color={INK} />
        </Pressable>
        <RNText className="flex-1 text-[17px] font-bold" style={{ color: INK }}>
          Checkout
        </RNText>
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
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
            {/* Delivery address */}
            <Section title="Deliver to">
              {address === null ? (
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Add delivery address"
                  className="flex-row items-center gap-3 rounded-2xl border border-dashed p-4"
                  style={{ borderColor: BRAND, backgroundColor: '#FFFFFF' }}
                >
                  <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: SURFACE_MUTED }}>
                    <Ionicons name="add" size={20} color={BRAND} />
                  </View>
                  <View className="flex-1">
                    <RNText className="text-[14px] font-bold" style={{ color: BRAND }}>
                      Add delivery address
                    </RNText>
                    <RNText className="text-[11.5px]" style={{ color: MUTED }}>
                      Saved addresses and manual entry
                    </RNText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={MUTED} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Change delivery address"
                  className="rounded-2xl border p-4"
                  style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}
                >
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-3">
                      <RNText className="text-[14px] font-bold" style={{ color: INK }}>
                        {address.fullName} · {address.phone}
                      </RNText>
                      <RNText className="mt-1 text-[12.5px] leading-5" style={{ color: MUTED }}>
                        {addressLine(address)}
                      </RNText>
                    </View>
                    <RNText className="text-[12.5px] font-bold" style={{ color: BRAND }}>
                      Change
                    </RNText>
                  </View>
                </Pressable>
              )}
            </Section>

            {/* Payment method */}
            <Section title="Payment method">
              <View className="rounded-2xl border" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
                <MethodRow
                  selected={method === 'COD'}
                  onSelect={() => setMethod('COD')}
                  icon="cash-outline"
                  title="Cash on Delivery"
                  subtitle="Pay when your order arrives"
                />
                <View className="h-px" style={{ backgroundColor: LINE }} />
                <MethodRow
                  selected={method === 'UPI'}
                  onSelect={() => setMethod('UPI')}
                  icon="phone-portrait-outline"
                  title="UPI"
                  subtitle="Pay with any UPI app"
                  trailing={
                    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: SURFACE_MUTED }}>
                      <RNText className="text-[9.5px] font-bold" style={{ color: MUTED }}>
                        DEMO
                      </RNText>
                    </View>
                  }
                />
                <View className="h-px" style={{ backgroundColor: LINE }} />
                <MethodRow
                  selected={method === 'CARD'}
                  onSelect={() => setMethod('CARD')}
                  icon="card-outline"
                  title="Card"
                  subtitle="Credit or debit card"
                  trailing={
                    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: SURFACE_MUTED }}>
                      <RNText className="text-[9.5px] font-bold" style={{ color: MUTED }}>
                        DEMO
                      </RNText>
                    </View>
                  }
                />
              </View>
            </Section>

            {/* Bill details — the server cart's own numbers, verbatim */}
            <Section title="Bill details">
              <View className="rounded-2xl border p-4" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
                <View className="gap-1.5">
                  <TotalRow label="Item total" value={cart.data.subtotalInPaise} />
                  {cart.data.discountInPaise > 0 ? (
                    <TotalRow label="Discount" value={-cart.data.discountInPaise} />
                  ) : null}
                  {cart.data.taxInPaise > 0 ? <TotalRow label="Tax" value={cart.data.taxInPaise} /> : null}
                  <TotalRow
                    label="Delivery"
                    value={cart.data.shippingInPaise}
                  />
                  <View className="mt-1 flex-row items-center justify-between border-t pt-2" style={{ borderColor: LINE }}>
                    <RNText className="text-[14px] font-bold" style={{ color: INK }}>
                      To pay
                    </RNText>
                    <RNText className="text-[15px] font-bold" style={{ color: BRAND }}>
                      {formatMoney(cart.data.totalInPaise)}
                    </RNText>
                  </View>
                  {cart.data.coupon !== null ? (
                    <RNText className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                      Coupon {cart.data.coupon.code} applied
                    </RNText>
                  ) : null}
                </View>
              </View>
            </Section>
          </ScrollView>

          {/* Sticky place-order bar */}
          <View
            className="absolute left-0 right-0 bottom-0 border-t px-4 pt-3"
            style={{
              borderColor: LINE,
              backgroundColor: '#FFFFFF',
              paddingBottom: Math.max(insets.bottom, 12) + 8,
              elevation: 6,
            }}
          >
            <View className="mb-2 flex-row items-center justify-between">
              <RNText className="text-[12px]" style={{ color: MUTED }}>
                {method === 'COD' ? 'Pay on delivery' : `Pay via ${method === 'CARD' ? 'card' : 'UPI'}`}
              </RNText>
              <RNText className="text-[14px] font-bold" style={{ color: INK }}>
                {formatMoney(cart.data.totalInPaise)}
              </RNText>
            </View>
            <Pressable
              onPress={() => void handlePlaceOrder()}
              disabled={address === null || placing}
              accessibilityRole="button"
              accessibilityLabel="Place order"
              accessibilityState={{ disabled: address === null || placing, busy: placing }}
              className={
                'h-[50px] rounded-full bg-brand items-center justify-center' +
                (address === null || placing ? ' opacity-55' : '')
              }
            >
              {placing ? (
                <RNText className="text-white text-[15px] font-bold">Placing order…</RNText>
              ) : (
                <RNText className="text-white text-[15px] font-bold">
                  {address === null ? 'Add address to continue' : 'Place order'}
                </RNText>
              )}
            </Pressable>
          </View>

          {/* Address book picker (signed-in): saved addresses from the server. */}
          <AddressPickerSheet
            visible={pickerOpen}
            selected={address}
            onClose={() => setPickerOpen(false)}
            onConfirm={(picked) => {
              setAddress(picked);
              rememberAddress(picked);
              setPickerOpen(false);
            }}
            onEdit={(prefill) => {
              setPickerOpen(false);
              setSheetOpen(true);
              editPrefillRef.current = prefill;
            }}
          />

          {/* Manual entry / edit. `sheetInitial` wins over the last-used
              default so editing a saved row opens THAT row's data. */}
          <AddressSheet
            visible={sheetOpen}
            initial={sheetInitial ?? address}
            contactDefaults={contactDefaults}
            canSaveToBook
            onSave={(saved, saveToBook) => {
              setAddress(saved);
              rememberAddress(saved);
              setSheetOpen(false);
              if (saveToBook) {
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
                  } catch {
                    // Saving to the book is optional; checkout proceeds either way.
                  }
                })();
              }
            }}
            onClose={() => {
              setSheetOpen(false);
              editPrefillRef.current = null;
            }}
          />

          {/* DEMO PAYMENT SHEET — online methods. Drives the provider outcome
              through the real state machine and navigates on polled state. */}
          {pendingPayment !== null ? (
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
 * The honest mock: "Pay now" simulates the provider's answer through the
 * server's webhook state machine (POST /payments/:id/simulate), then the
 * sheet POLLS the order's payment rows — it never declares success on its
 * own authority. "Cancel" parks the payment back to a retryable state.
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
  const [phase, setPhase] = useState<'confirm' | 'processing' | 'failed'>('confirm');

  async function simulate(outcome: 'success' | 'failure') {
    setPhase('processing');
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
      Alert.alert('Payment error', 'We could not reach the payment service. The order is saved — retry from the order screen.');
      onDone('pending');
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
                The demo provider declined this payment. Your order is saved.
              </RNText>
              <Pressable
                onPress={() => void simulate('success')}
                accessibilityRole="button"
                accessibilityLabel="Retry payment"
                className="h-[44px] rounded-full bg-brand items-center justify-center mt-2 w-full"
              >
                <RNText className="text-white text-[14px] font-bold">Retry payment</RNText>
              </Pressable>
              <Pressable
                onPress={() => onDone('failed')}
                accessibilityRole="button"
                accessibilityLabel="Continue with unpaid order"
                className="h-[40px] items-center justify-center w-full"
              >
                <RNText className="text-[13px] font-semibold" style={{ color: MUTED }}>
                  Continue to order
                </RNText>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => void simulate('success')}
                accessibilityRole="button"
                accessibilityLabel="Pay now"
                className="h-[46px] rounded-full bg-brand items-center justify-center mt-4"
              >
                <RNText className="text-white text-[14.5px] font-bold">Pay now</RNText>
              </Pressable>
              <Pressable
                onPress={() => void simulate('failure')}
                accessibilityRole="button"
                accessibilityLabel="Simulate a declined payment"
                className="h-[34px] items-center justify-center mt-1"
              >
                <RNText className="text-[11.5px]" style={{ color: MUTED }}>
                  Simulate a declined payment
                </RNText>
              </Pressable>
              <Pressable
                onPress={cancel}
                accessibilityRole="button"
                accessibilityLabel="Pay later"
                className="h-[36px] items-center justify-center"
              >
                <RNText className="text-[13px] font-semibold" style={{ color: MUTED }}>
                  Pay on delivery instead
                </RNText>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="px-4 pt-3">
      <RNText className="mb-2 text-[13px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
        {title}
      </RNText>
      {children}
    </View>
  );
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
      className="flex-row items-center gap-3 p-4"
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: selected ? BRAND : SURFACE_MUTED }}
      >
        <Ionicons name={icon} size={18} color={selected ? '#FFFFFF' : INK} />
      </View>
      <View className="flex-1">
        <RNText className="text-[14px] font-bold" style={{ color: INK }}>
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

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row items-center justify-between">
      <RNText className="text-[12.5px]" style={{ color: MUTED }}>
        {label}
      </RNText>
      <RNText className="text-[12.5px] font-semibold" style={{ color: INK }}>
        {formatMoney(value)}
      </RNText>
    </View>
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

/** Single-line rendering of the saved address for the card. */
function addressLine(address: CheckoutAddress): string {
  return [
    address.line1,
    address.landmark ?? '',
    `${address.city}, ${address.state} ${address.postalCode}`,
  ]
    .filter((part) => part.trim() !== '')
    .join(', ');
}

/** Map transport/service failures to what a customer should read. */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('empty cart')) {
    return 'Your cart changed before the order was placed. Please review it and try again.';
  }
  if (lower.includes('store')) {
    return 'This order cannot be fulfilled right now. Please try again shortly.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('aborted')) {
    return 'Unable to connect. Please check your connection and try again.';
  }
  return 'Could not place the order. Please try again in a moment.';
}
