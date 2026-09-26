import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, Switch, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { journeyApi } from '../../src/api/journey';
import { AuthGate } from '../../src/components/AuthGate';
import { SubScreenHeader } from '../../src/components/navigation/SubScreenHeader';
import { useAuthStore } from '../../src/stores/auth-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/** Server-truth prefs with local echo while a toggle is in flight. */
interface Prefs {
  orderUpdates: boolean;
  promotions: boolean;
  stockAlerts: boolean;
}

const PREF_ROWS: Array<{ key: keyof Prefs; icon: string; title: string; message: string }> = [
  {
    key: 'orderUpdates',
    icon: 'receipt-outline',
    title: 'Order updates',
    message: 'Confirmations, dispatch and delivery notifications.',
  },
  {
    key: 'promotions',
    icon: 'pricetag-outline',
    title: 'Offers & promotions',
    message: 'Seasonal offers and coupon announcements.',
  },
  {
    key: 'stockAlerts',
    icon: 'notifications-outline',
    title: 'Back-in-stock alerts',
    message: 'Notify Me subscriptions for sold-out products.',
  },
];

/**
 * Settings — notification preferences backed by
 * `GET/PATCH /me/notification-prefs`. The server is the source of truth;
 * a failed toggle rolls the switch back with an error note.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();

  const prefs = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: journeyApi.getNotificationPrefs,
    enabled: session !== null,
    staleTime: 60_000,
  });

  const update = useMutation({
    mutationFn: (next: Prefs) => journeyApi.updateNotificationPrefs(next),
    onSuccess: (saved) => queryClient.setQueryData(['notification-prefs'], saved),
  });

  if (session === null) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <AuthGate
          icon="settings-outline"
          title="Verify your number to manage settings"
          message="Settings are personal. Verify your phone to continue."
          redirectTo="/(shop)/settings"
        />
      </View>
    );
  }

  const current: Prefs = prefs.data ?? { orderUpdates: true, promotions: true, stockAlerts: true };

  const toggle = (key: keyof Prefs) => {
    if (update.isPending) return;
    update.mutate({ ...current, [key]: !current[key] });
  };

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <SubScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} className="gap-3">
        <RNText className="text-[13px] font-bold" style={{ color: MUTED }}>
          NOTIFICATION PREFERENCES
        </RNText>

        {prefs.isPending ? (
          <View className="rounded-2xl border bg-white p-4" style={{ borderColor: LINE }}>
            <RNText className="text-[13px]" style={{ color: MUTED }}>
              Loading your preferences…
            </RNText>
          </View>
        ) : prefs.isError ? (
          <View className="rounded-2xl border bg-white p-4" style={{ borderColor: LINE }}>
            <RNText className="text-[13px]" style={{ color: MUTED }}>
              Preferences could not be loaded.
            </RNText>
            <Pressable onPress={() => void prefs.refetch()} hitSlop={6} className="mt-2 self-start">
              <RNText className="text-[13px] font-bold" style={{ color: BRAND }}>
                Retry
              </RNText>
            </Pressable>
          </View>
        ) : (
          PREF_ROWS.map((row) => (
            <View
              key={row.key}
              className="flex-row items-center gap-3 rounded-2xl border bg-white p-4"
              style={{ borderColor: LINE }}
            >
              <View
                className="h-9 w-9 items-center justify-center rounded-xl"
                style={{ backgroundColor: '#EDF4F0' }}
              >
                <Ionicons name={row.icon as never} size={16} color={BRAND} />
              </View>
              <View className="flex-1">
                <RNText className="text-[13.5px] font-semibold" style={{ color: INK }}>
                  {row.title}
                </RNText>
                <RNText className="text-[11.5px] leading-4" style={{ color: MUTED }}>
                  {row.message}
                </RNText>
              </View>
              <Switch
                value={current[row.key]}
                onValueChange={() => toggle(row.key)}
                disabled={update.isPending}
                trackColor={{ false: LINE, true: BRAND }}
                thumbColor="#FFFFFF"
                accessibilityLabel={row.title}
              />
            </View>
          ))
        )}

        {update.isError ? (
          <RNText className="text-[12.5px] font-semibold" style={{ color: '#B3453E' }}>
            Could not save that change — try again.
          </RNText>
        ) : null}

        <View className="mt-3 rounded-2xl border bg-white p-4" style={{ borderColor: LINE }}>
          <RNText className="text-[13.5px] font-semibold" style={{ color: INK }}>
            App version
          </RNText>
          <RNText className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
            {`Sakya Farms customer app · v${Constants.expoConfig?.version ?? '—'}`}
          </RNText>
        </View>
      </ScrollView>
    </View>
  );
}
