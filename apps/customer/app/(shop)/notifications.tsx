import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { notificationsApi } from '../../src/api/notifications-api';
import { AuthGate } from '../../src/components/AuthGate';
import { ErrorState } from '../../src/components/ErrorState';
import { SkeletonBlock } from '../../src/components/LoadingSkeleton';
import { useAuthStore } from '../../src/stores/auth-store';
import type { NotificationView } from '@sakya/types';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const CANVAS = '#FAF7F0';

/**
 * Notification inbox — the caller's persisted Notification rows.
 *
 * Every entry is a real record the backend wrote (order confirmations,
 * packing, out-for-delivery, delivered, cancellations). Tapping an entry with
 * an `orderId` in its payload opens that order; tap also marks it read. The
 * unread count comes from the server on every page — no client bookkeeping.
 */
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const restoring = useAuthStore((state) => state.restoring);

  return (
    <View className="flex-1" style={{ backgroundColor: CANVAS, paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 px-3 pb-1 pt-2">
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
          Notifications
        </RNText>
      </View>

      {restoring ? (
        <View className="gap-3 px-4 pt-4">
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} className="h-20 w-full rounded-2xl" />
          ))}
        </View>
      ) : session === null ? (
        <AuthGate
          icon="notifications-outline"
          title="Verify your number to see your notifications"
          message="Order updates and farm news land here once you verify your phone number."
          redirectTo="/(shop)/notifications"
        />
      ) : (
        <Inbox />
      )}
    </View>
  );
}

function Inbox() {
  const queryClient = useQueryClient();
  const inbox = useQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: () => notificationsApi.list(1, 50),
    staleTime: 15_000,
    // The inbox refreshes gently; pushes and the order poller cover the rest.
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] }),
  });

  if (inbox.isPending) {
    return (
      <View className="gap-3 px-4 pt-4">
        {[0, 1, 2, 3].map((index) => (
          <SkeletonBlock key={index} className="h-20 w-full rounded-2xl" />
        ))}
      </View>
    );
  }

  if (inbox.isError || inbox.data === undefined) {
    return (
      <ErrorState
        title="Could not load notifications"
        message="We could not reach your notifications just now. Check your connection and try again."
        onRetry={() => void inbox.refetch()}
      />
    );
  }

  const { items, unreadCount } = inbox.data;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100, gap: 10 }}
      ListHeaderComponent={
        items.length > 0 && unreadCount > 0 ? (
          <View className="flex-row items-center justify-between px-1 pb-1">
            <RNText className="text-[12.5px] font-semibold" style={{ color: BRAND }}>
              {unreadCount} unread
            </RNText>
            <Pressable
              onPress={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              accessibilityRole="button"
              accessibilityLabel="Mark all notifications read"
              hitSlop={6}
            >
              <RNText className="text-[12.5px] font-semibold" style={{ color: MUTED }}>
                Mark all read
              </RNText>
            </Pressable>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View className="items-center gap-2 px-8 pt-24">
          <View
            className="h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: '#E7F0EE' }}
          >
            <Ionicons name="notifications-off-outline" size={26} color={BRAND} />
          </View>
          <RNText className="pt-1 text-[15px] font-bold" style={{ color: INK }}>
            All caught up
          </RNText>
          <RNText className="text-center text-[12.5px] leading-4" style={{ color: MUTED }}>
            Order updates and farm news will appear here as they happen.
          </RNText>
        </View>
      }
      renderItem={({ item }) => (
        <NotificationRow
          item={item}
          onPress={() => {
            if (item.readAt === null) markRead.mutate(item.id);
            const orderId = item.data?.orderId;
            if (typeof orderId === 'string' && orderId.length > 0) {
              router.push(`/(shop)/orders/${orderId}`);
            }
          }}
        />
      )}
    />
  );
}

function NotificationRow({ item, onPress }: { item: NotificationView; onPress: () => void }) {
  const isUnread = item.readAt === null;
  const when = new Date(item.createdAt).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${isUnread ? 'Unread' : 'Read'}`}
      className="rounded-2xl border p-4"
      style={{
        borderColor: isUnread ? '#CDE3DE' : LINE,
        backgroundColor: isUnread ? '#F4FAF8' : '#FFFFFF',
      }}
    >
      <View className="flex-row items-start gap-3">
        <View
          className="h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: isUnread ? '#E7F0EE' : '#F1EEE6' }}
        >
          <Ionicons
            name={notificationIcon(item)}
            size={17}
            color={isUnread ? BRAND : MUTED}
          />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <RNText
              className="flex-1 text-[13.5px] font-bold"
              style={{ color: INK }}
              numberOfLines={1}
            >
              {item.title}
            </RNText>
            {isUnread ? (
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: BRAND }} />
            ) : null}
          </View>
          <RNText className="mt-0.5 text-[12px] leading-4" style={{ color: MUTED }}>
            {item.body}
          </RNText>
          <RNText className="mt-1 text-[10.5px]" style={{ color: MUTED }}>
            {when}
          </RNText>
        </View>
      </View>
    </Pressable>
  );
}

/** Icon per notification payload; order updates get the receipt glyph. */
function notificationIcon(item: NotificationView): keyof typeof Ionicons.glyphMap {
  const status = item.data?.status;
  if (typeof status === 'string') {
    if (status === 'CANCELLED') return 'close-circle-outline';
    if (status === 'DELIVERED') return 'checkmark-circle-outline';
    if (status === 'OUT_FOR_DELIVERY') return 'bicycle-outline';
  }
  return 'receipt-outline';
}
