import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ordersApi } from '../../src/api/orders-api';
import { AuthGate } from '../../src/components/AuthGate';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { SkeletonBlock } from '../../src/components/LoadingSkeleton';
import { useAuthStore } from '../../src/stores/auth-store';
import type { OrderResponse } from '@sakya/types';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

/**
 * Orders tab — the caller's real orders from `GET /orders`.
 *
 * Guests get an authentication gate (Blinkit behavior: browsing is open,
 * orders are personal). Data is the server's — statuses, totals and items are
 * rendered exactly as the API reports them, never derived client-side.
 */
export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const restoring = useAuthStore((state) => state.restoring);

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-1 pt-3">
        <RNText className="text-[22px] font-bold text-ink">Orders</RNText>
        <RNText className="mt-0.5 text-[13px] text-ink-soft">
          Your farm orders, all in one place.
        </RNText>
      </View>

      {restoring ? (
        <View className="gap-3 px-4 pt-4">
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </View>
      ) : session === null ? (
        // Orders are personal: the gate captures this route so authentication
        // returns the customer straight back here.
        <AuthGate
          icon="receipt-outline"
          title="Verify your number to see your orders"
          message="Your order history and delivery updates live here once you verify your phone number."
          redirectTo="/(shop)/orders"
        />
      ) : (
        <OrdersList />
      )}
    </View>
  );
}

function OrdersList() {
  const orders = useQuery({
    queryKey: ['orders', 'list', 1],
    queryFn: () => ordersApi.list(1, 20),
    staleTime: 30_000,
  });

  if (orders.isPending) {
    return (
      <View className="gap-3 px-4 pt-4">
        {[0, 1, 2].map((index) => (
          <SkeletonBlock key={index} className="h-24 w-full rounded-2xl" />
        ))}
      </View>
    );
  }

  if (orders.isError) {
    return (
      <ErrorState
        title="Could not load orders"
        message="We could not reach your orders just now. Check your connection and try again."
        onRetry={() => void orders.refetch()}
      />
    );
  }

  const items = orders.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        image={require('../../src/assets/no-orders.png')}
        title="No orders yet"
        message="When you place your first farm order, it will show up here."
        ctaLabel="Start shopping"
        onCta={() => router.push('/(shop)')}
      />
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(order) => order.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 130, gap: 12 }}
      renderItem={({ item }) => <OrderCard order={item} />}
    />
  );
}

function OrderCard({ order }: { order: OrderResponse }) {
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const placed = order.placedAt ?? order.createdAt;
  const date = new Date(placed).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const firstItem = order.items[0];

  return (
    <Pressable
      onPress={() => router.push(`/(shop)/orders/${order.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderNumber}, status ${order.status}`}
      className="rounded-2xl border border-line bg-white p-3.5"
    >
      <View className="flex-row items-center justify-between">
        <RNText className="text-[14px] font-bold" style={{ color: INK }}>
          {order.orderNumber}
        </RNText>
        <View className="rounded-full bg-brand/10 px-2.5 py-1">
          <RNText className="text-[10.5px] font-bold" style={{ color: BRAND }}>
            {order.status}
          </RNText>
        </View>
      </View>
      <RNText className="mt-0.5 text-[11.5px]" style={{ color: MUTED }}>
        Placed {date} · {itemCount} item{itemCount === 1 ? '' : 's'}
      </RNText>
      {firstItem ? (
        <RNText className="mt-1.5 text-[12.5px]" style={{ color: INK }} numberOfLines={1}>
          {firstItem.productTitle}
          {order.items.length > 1 ? ` +${order.items.length - 1} more` : ''}
        </RNText>
      ) : null}
      <View className="mt-2 flex-row items-center justify-between">
        <RNText className="text-[15px] font-bold" style={{ color: INK }}>
          ₹{(order.totalInPaise / 100).toLocaleString('en-IN')}
        </RNText>
        <View className="flex-row items-center gap-0.5">
          <RNText className="text-[12px] font-bold" style={{ color: BRAND }}>
            View details
          </RNText>
          <Ionicons name="chevron-forward" size={13} color={BRAND} />
        </View>
      </View>
    </Pressable>
  );
}
