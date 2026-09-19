import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ordersApi } from '../../../src/api/orders-api';
import { orderActionsApi } from '../../../src/api/order-actions';
import { checkoutApi } from '../../../src/api/checkout';
import { AuthGate } from '../../../src/components/AuthGate';
import { ErrorState } from '../../../src/components/ErrorState';
import { SkeletonBlock } from '../../../src/components/LoadingSkeleton';
import { CancelReasonSheet } from '../../../src/components/orders/CancelReasonSheet';
import { formatMoney } from '../../../src/lib/format';
import {
  cancellationBanner,
  codPendingNote,
  deliveryStages,
  deliveryUpdates,
  isOrderActive,
  orderStatusLabel,
  type DeliveryStageView,
  type DeliveryUpdate,
} from '../../../src/lib/order-tracking';
import { cancellationAvailability } from '../../../src/lib/order-status-presentation';
import { useAuthStore } from '../../../src/stores/auth-store';
import type { OrderResponse, OrderStatus } from '@sakya/types';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/**
 * Order detail — real server data only.
 *
 * Renders exactly what `GET /orders/:id` returns: items, server-computed
 * totals, payment status and the actual status history timeline. No invented
 * tracking events, no client-side totals.
 */
export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, justPlaced } = useLocalSearchParams<{ id: string; justPlaced?: string }>();
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();
  const isFresh = justPlaced === '1';
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const order = useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: () => ordersApi.get(id as string),
    enabled: typeof id === 'string' && session !== null,
    staleTime: 30_000,
    // Live tracking: an order that can still change status gets gentle
    // server polling so delivery updates appear without a manual refresh.
    // Terminal orders (delivered/cancelled/refunded/failed) never poll.
    refetchInterval: (query) => {
      const data = query.state.data as OrderResponse | undefined;
      return data !== undefined && isOrderActive(data) ? 15_000 : false;
    },
  });

  // While a fresh online payment is unresolved, poll server payment state —
  // capture arrives via webhook, and this is the only honest way to see it.
  useFreshOrderPolling(order.data, isFresh);

  /**
   * Customer cancellation. The server is the authority on whether the order
   * can be cancelled; its reason/constraint errors are shown verbatim in the
   * sheet. On success the detail query is replaced with the cancelled order.
   */
  const submitCancellation = async (reason: string) => {
    if (typeof id !== 'string' || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const cancelled = await orderActionsApi.cancel(id, { reason });
      queryClient.setQueryData(['orders', 'detail', id], cancelled);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      setCancelSheetOpen(false);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'Could not cancel this order. Try again.');
    } finally {
      setCancelling(false);
    }
  };

  if (session === null) {
    return (
      <View style={{ backgroundColor: '#FAF7F0', paddingTop: insets.top }} className="flex-1">
        <AuthGate
          icon="lock-closed-outline"
          title="Verify your number to view this order"
          message="Order details are personal. Verify your phone to continue."
          redirectTo={`/(shop)/orders/${id as string}`}
        />
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
          Order details
        </RNText>
      </View>

      {order.isPending ? (
        <View className="gap-3 px-4 pt-2">
          <SkeletonBlock className="h-20 w-full rounded-2xl" />
          <SkeletonBlock className="h-40 w-full rounded-2xl" />
          <SkeletonBlock className="h-32 w-full rounded-2xl" />
        </View>
      ) : order.isError || !order.data ? (
        <ErrorState
          title="Could not load this order"
          message="We could not reach the order just now. Check your connection and try again."
          onRetry={() => void order.refetch()}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 60 }}
          refreshControl={
            <RefreshControl
              refreshing={order.isRefetching}
              onRefresh={() => void order.refetch()}
              tintColor={BRAND}
              colors={[BRAND]}
            />
          }
        >
          {isFresh ? <PlacedBanner order={order.data} /> : null}
          <OrderBody
            order={order.data}
            onCancelPress={() => setCancelSheetOpen(true)}
          />
        </ScrollView>
      )}

      <CancelReasonSheet
        visible={cancelSheetOpen}
        orderNumber={order.data?.orderNumber ?? ''}
        submitting={cancelling}
        errorMessage={cancelError}
        onClose={() => {
          setCancelSheetOpen(false);
          setCancelError(null);
        }}
        onConfirm={(reason) => void submitCancellation(reason)}
      />
    </View>
  );
}

function OrderBody({ order, onCancelPress }: { order: OrderResponse; onCancelPress: () => void }) {
  const placed = order.placedAt ?? order.createdAt;
  const date = new Date(placed).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const cancelBanner = cancellationBanner(order);
  const stages = deliveryStages(order.status as OrderStatus);
  const updates = deliveryUpdates(order);
  const codNote = codPendingNote(order);

  return (
    <View className="gap-3 px-4 pt-1">
      {/* Summary card */}
      <View className="rounded-2xl border p-4" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
        <View className="flex-row items-center justify-between">
          <RNText className="text-[16px] font-bold" style={{ color: INK }}>
            {order.orderNumber}
          </RNText>
          <View className="rounded-full bg-brand/10 px-2.5 py-1">
            <RNText className="text-[10.5px] font-bold" style={{ color: BRAND }}>
              {orderStatusLabel(order.status)}
            </RNText>
          </View>
        </View>
        <RNText className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
          Placed {date} · Payment: {order.paymentStatus}
        </RNText>
      </View>

      {/* Cancelled state — backend reason when the operator recorded one */}
      {cancelBanner ? (
        <View
          className="flex-row items-start gap-3 rounded-2xl border p-4"
          style={{ borderColor: '#E8C9C4', backgroundColor: '#FDF4F2' }}
        >
          <Ionicons name="close-circle" size={20} color="#B3453E" />
          <View className="flex-1">
            <RNText className="text-[13.5px] font-bold" style={{ color: '#B3453E' }}>
              {cancelBanner.title}
            </RNText>
            <RNText className="mt-0.5 text-[12px] leading-4" style={{ color: '#B3453E' }}>
              {cancelBanner.message}
            </RNText>
          </View>
        </View>
      ) : null}

      {/* Delivery tracker — stages derived from the real order status */}
      {cancelBanner === null ? (
        <View className="rounded-2xl border p-4" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
          <View className="mb-4 flex-row items-center justify-between">
            <RNText className="text-[14px] font-bold" style={{ color: INK }}>
              Delivery status
            </RNText>
            {isOrderActive(order) ? (
              <View className="flex-row items-center gap-1.5">
                <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND }} />
                <RNText className="text-[10.5px] font-semibold" style={{ color: BRAND }}>
                  Live updates
                </RNText>
              </View>
            ) : null}
          </View>
          <DeliveryTracker stages={stages} />
        </View>
      ) : null}

      {/* Delivery updates — the order's real history, newest first */}
      <View className="rounded-2xl border p-4" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
        <RNText className="mb-3 text-[14px] font-bold" style={{ color: INK }}>
          Delivery updates
        </RNText>
        <DeliveryUpdatesList updates={updates} />
      </View>

      {/* Cancel — offered while the order is still early in its journey */}
      {cancellationAvailability(order) === 'available' ? (
        <Pressable
          onPress={onCancelPress}
          accessibilityRole="button"
          accessibilityLabel={`Cancel order ${order.orderNumber}`}
          className="h-11 items-center justify-center rounded-full border"
          style={{ borderColor: '#E8C9C4', backgroundColor: '#FFFFFF' }}
        >
          <RNText className="text-[13px] font-bold" style={{ color: '#B3453E' }}>
            Cancel order
          </RNText>
        </Pressable>
      ) : null}

      {/* COD note — explains why payment stays pending by design */}
      {codNote ? (
        <View
          className="flex-row items-start gap-2.5 rounded-2xl border p-3.5"
          style={{ borderColor: LINE, backgroundColor: '#FFF9EC' }}
        >
          <Ionicons name="cash-outline" size={16} color="#8A6A1F" style={{ marginTop: 1 }} />
          <RNText className="flex-1 text-[12px] leading-4" style={{ color: '#8A6A1F' }}>
            {codNote}
          </RNText>
        </View>
      ) : null}

      {/* Items */}
      <View className="rounded-2xl border p-4" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
        <RNText className="mb-2.5 text-[14px] font-bold" style={{ color: INK }}>
          Items
        </RNText>
        <View className="gap-2.5">
          {order.items.map((item) => (
            <View key={item.id} className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <RNText className="text-[13px] font-semibold" style={{ color: INK }}>
                  {item.productTitle}
                </RNText>
                <RNText className="text-[11.5px]" style={{ color: MUTED }}>
                  {item.variantTitle} · Qty {item.quantity}
                </RNText>
              </View>
              <RNText className="text-[13px] font-bold" style={{ color: INK }}>
                {formatMoney(item.totalInPaise)}
              </RNText>
            </View>
          ))}
        </View>
      </View>

      {/* Totals — server-computed values, verbatim */}
      <View className="rounded-2xl border p-4" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
        <RNText className="mb-2.5 text-[14px] font-bold" style={{ color: INK }}>
          Bill details
        </RNText>
        <View className="gap-1.5">
          <TotalRow label="Subtotal" value={order.subtotalInPaise} />
          {order.discountInPaise > 0 ? (
            <TotalRow label="Discount" value={-order.discountInPaise} />
          ) : null}
          {order.taxInPaise > 0 ? <TotalRow label="Tax" value={order.taxInPaise} /> : null}
          <TotalRow label="Shipping" value={order.shippingInPaise} />
          <View className="mt-1 flex-row items-center justify-between border-t pt-2" style={{ borderColor: LINE }}>
            <RNText className="text-[14px] font-bold" style={{ color: INK }}>
              Total
            </RNText>
            <RNText className="text-[15px] font-bold" style={{ color: BRAND }}>
              {formatMoney(order.totalInPaise)}
            </RNText>
          </View>
        </View>
      </View>

      {/* Shipping address — the order's own snapshot */}
      {order.shippingAddress != null && Object.keys(order.shippingAddress).length > 0 ? (
        <View className="rounded-2xl border p-4" style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}>
          <RNText className="mb-1.5 text-[14px] font-bold" style={{ color: INK }}>
            Delivery address
          </RNText>
          <RNText className="text-[12.5px] leading-5" style={{ color: MUTED }}>
            {Object.values(order.shippingAddress)
              .filter((part) => typeof part === 'string' && part.length > 0)
              .join(', ')}
          </RNText>
        </View>
      ) : null}
    </View>
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

/**
 * Horizontal 4-stage tracker: Placed → Packed → Out for delivery → Delivered.
 * Done stages are filled dots, the current stage is a ring with an inner dot,
 * upcoming stages are grey rings. Connector halves fill as progress advances.
 */
function DeliveryTracker({ stages }: { stages: DeliveryStageView[] }) {
  return (
    <View className="flex-row">
      {stages.map((item, index) => (
        <View key={item.stage} className="flex-1 items-center">
          <View className="w-full flex-row items-center">
            <View
              className="h-[2px] flex-1"
              style={{
                backgroundColor:
                  index === 0
                    ? 'transparent'
                    : item.state === 'upcoming'
                      ? LINE
                      : BRAND,
              }}
            />
            <View
              className="h-3.5 w-3.5 items-center justify-center rounded-full border-2"
              style={{
                borderColor: item.state === 'upcoming' ? '#C9C4B8' : BRAND,
                backgroundColor: item.state === 'done' ? BRAND : '#FFFFFF',
              }}
              accessible
              accessibilityLabel={`${item.label}${item.state === 'done' ? ' — done' : item.state === 'current' ? ' — current' : ''}`}
            >
              {item.state === 'current' ? (
                <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND }} />
              ) : null}
            </View>
            <View
              className="h-[2px] flex-1"
              style={{
                backgroundColor:
                  index === stages.length - 1
                    ? 'transparent'
                    : (stages[index + 1]?.state ?? 'upcoming') !== 'upcoming'
                      ? BRAND
                      : LINE,
              }}
            />
          </View>
          <RNText
            className="mt-1.5 text-center text-[10px] font-semibold"
            style={{ color: item.state === 'upcoming' ? '#C9C4B8' : item.state === 'current' ? BRAND : INK }}
          >
            {item.label}
          </RNText>
        </View>
      ))}
    </View>
  );
}

/** Vertical feed of real status events, newest first, with operator reasons. */
function DeliveryUpdatesList({ updates }: { updates: DeliveryUpdate[] }) {
  return (
    <View>
      {updates.map((update, index) => {
        const isLast = index === updates.length - 1;
        const when = new Date(update.timestamp).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
        return (
          <View key={update.id} className="flex-row gap-3">
            <View className="items-center">
              <View
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: index === 0 ? BRAND : '#C9C4B8', marginTop: 4 }}
              />
              {!isLast ? (
                <View className="my-0.5 w-px flex-1" style={{ backgroundColor: LINE }} />
              ) : null}
            </View>
            <View className="flex-1" style={{ paddingBottom: isLast ? 0 : 12 }}>
              <RNText
                className="text-[13px] font-semibold"
                style={{ color: index === 0 ? INK : MUTED }}
              >
                {update.title}
              </RNText>
              {update.detail !== null && update.detail.trim() !== '' ? (
                <RNText className="mt-0.5 text-[11.5px] leading-4" style={{ color: MUTED }}>
                  {update.detail}
                </RNText>
              ) : null}
              <RNText className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                {when}
              </RNText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Order-placed confirmation, shown only when arriving straight from checkout.
 *
 * The copy stays honest about payment: COD says "pay on delivery"; an online
 * method says "pending" until the server's payment status says otherwise —
 * the poller below keeps the order query fresh while the webhook lands.
 */
function PlacedBanner({ order }: { order: OrderResponse }) {
  const paid = order.paymentStatus === 'CAPTURED';
  return (
    <View
      className="mx-4 mt-3 flex-row items-center gap-3 rounded-2xl border p-4"
      style={{ borderColor: LINE, backgroundColor: '#FFFFFF' }}
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-brand/10">
        <Ionicons
          name={paid ? 'checkmark-circle' : 'time-outline'}
          size={22}
          color={BRAND}
        />
      </View>
      <View className="flex-1">
        <RNText className="text-[14.5px] font-bold" style={{ color: INK }}>
          {paid ? 'Order confirmed' : 'Order placed'}
        </RNText>
        <RNText className="text-[12px] leading-4" style={{ color: MUTED }}>
          {paid
            ? 'Payment received. We are getting your order ready.'
            : order.paymentStatus === 'PENDING'
              ? 'We have received your order. Payment is pending.'
              : `Payment status: ${order.paymentStatus}`}
        </RNText>
      </View>
    </View>
  );
}

/**
 * Poll the order while it is freshly placed and payment is unresolved.
 *
 * Capture is decided by the provider webhook on the server, so the client can
 * only watch: a short, bounded poll keeps the banner and payment status honest
 * without hammering the API. Never runs for COD orders — those legitimately
 * stay PENDING until delivery.
 */
function useFreshOrderPolling(order: OrderResponse | undefined, fresh: boolean) {
  const queryClient = useQueryClient();
  const orderId = order?.id;
  const attempts = useRef(0);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!fresh || orderId === undefined || order === undefined) return;
    // COD stays PENDING by design — polling would never resolve.
    const isOnlinePending =
      order.paymentStatus === 'PENDING' &&
      order.payments.some((payment) => payment.provider !== 'MANUAL');
    if (!isOnlinePending) return;

    setPolling(true);
    const MAX_ATTEMPTS = 20;
    const INTERVAL_MS = 1_500;

    const interval = setInterval(() => {
      attempts.current += 1;
      void (async () => {
        try {
          const payments = await checkoutApi.listPayments(orderId);
          const captured = payments.some((payment) => payment.status === 'CAPTURED');
          if (captured || attempts.current >= MAX_ATTEMPTS) {
            setPolling(false);
            clearInterval(interval);
            await queryClient.invalidateQueries({ queryKey: ['orders', 'detail'] });
          }
        } catch {
          if (attempts.current >= MAX_ATTEMPTS) {
            setPolling(false);
            clearInterval(interval);
          }
        }
      })();
    }, INTERVAL_MS);

    return () => {
      clearInterval(interval);
      setPolling(false);
      attempts.current = 0;
    };
  }, [fresh, orderId, order, queryClient]);

  return polling;
}
