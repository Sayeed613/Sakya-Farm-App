import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text as RNText, View } from 'react-native';

import { notificationsApi } from '../../api/notifications-api';
import { useAuthStore } from '../../stores/auth-store';
import { useDeliveryLocation } from '../../hooks/use-delivery-location';

const BRAND = '#0B594C';
const MUTED = '#8C8A80';

export interface HomeHeaderProps {
  /** Where the location affordance navigates; hook only until a real flow exists. */
  onLocationPress?: () => void;
  /** Shipping trust line shown under the location row. */
  trustLine?: string;
}

/**
 * The delivery header: context label, "Home" + location affordance.
 *
 * Entrance is a one-shot fade/rise using RN's `Animated` with a ref-held value,
 * so it runs once on mount and never restarts on re-render.
 */
export function HomeHeader({ onLocationPress, trustLine }: HomeHeaderProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const location = useDeliveryLocation();
  const session = useAuthStore((state) => state.session);

  // Unread badge for the bell. Only while signed in — guests see no bell.
  const inbox = useQuery({
    queryKey: ['notifications', 'inbox'],
    queryFn: () => notificationsApi.list(1, 1),
    enabled: session !== null,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const unreadCount = inbox.data?.unreadCount ?? 0;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
      }}
      className="flex-row items-center justify-between px-4 pb-1 pt-2"
    >
      <Pressable
        onPress={onLocationPress}
        accessibilityRole="button"
        accessibilityLabel="Change delivery location"
        className="flex-1"
      >
        <RNText className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
          Delivering to
        </RNText>
        <View className="mt-0.5 flex-row items-center gap-1">
          <Ionicons name="location" size={15} color={BRAND} />
          <RNText className="max-w-[220px] text-[10px] font-bold text-ink" numberOfLines={1}>
            {location.status === 'locating' ? 'Locating…' : location.label}
          </RNText>
          <Ionicons name="chevron-down" size={15} color={MUTED} />
        </View>
      </Pressable>
      {session !== null ? (
        <Pressable
          onPress={() => router.push('/(shop)/notifications')}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: '#E7F0EE' }}
        >
          <Ionicons name="notifications-outline" size={19} color={BRAND} />
          {unreadCount > 0 ? (
            <View
              className="absolute items-center justify-center rounded-full"
              style={{ top: 3, right: 3, minWidth: 15, height: 15, paddingHorizontal: 3, backgroundColor: '#B3453E' }}
            >
              <RNText className="text-[9px] font-bold leading-[13px]" style={{ color: '#FFFFFF' }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </RNText>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      {trustLine ? (
        <RNText className="mt-1 text-[10.5px]" style={{ color: MUTED }}>
          {trustLine}
        </RNText>
      ) : null}
    </Animated.View>
  );
}
