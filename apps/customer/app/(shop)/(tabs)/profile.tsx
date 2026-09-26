import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addressesApi } from '../../../src/api/notifications-api';
import { AuthGate } from '../../../src/components/AuthGate';
import { LoadingState } from '../../../src/components/LoadingState';
import { colors } from '../../../src/theme';
import { useAuthStore } from '../../../src/stores/auth-store';

const BRAND = '#0B594C';
const SUBTLE = '#8C8A80';
const GREEN_PALE = '#F0F6EC';
const RED = '#B42318';
const RED_SOFT = '#FDECEC';

/*
 * Styling is NativeWind (Tailwind) classes. Named palette classes (text-ink,
 * text-brand, text-brand-dark, text-danger) mirror src/theme tokens; exact
 * off-palette values use arbitrary classes. The few things Tailwind cannot
 * express on native (box shadows, the hairline divider) stay inline.
 */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();

  const session = useAuthStore((state) => state.session);
  const restoring = useAuthStore((state) => state.restoring);
  const logout = useAuthStore((state) => state.logout);

  const [signingOut, setSigningOut] = useState(false);

  if (restoring) {
    return <LoadingState message="Loading your account…" />;
  }

  if (session === null) {
    return (
      <View className="flex-1 bg-[#F7F3E9]" style={{ paddingTop: insets.top }}>
        <AuthGate
          icon="person-outline"
          title="Verify your number to manage your account"
          message="Your profile, addresses and app settings live here."
          redirectTo="/(shop)/profile"
        />
      </View>
    );
  }

  const { user } = session;

  const displayName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  async function handleLogout() {
    if (signingOut) return;

    setSigningOut(true);

    try {
      await logout();
      router.replace('/(shop)');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <View className="flex-1 bg-[#F7F3E9]" style={{ paddingTop: insets.top }}>
      {/* Single leafy hero backdrop */}
      <View pointerEvents="none" className="absolute left-0 right-0 top-0 h-[280px]">
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../../src/images/profile-header.png')}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
        <LinearGradient
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          colors={[
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0.20)',
            'rgba(247,243,233,0.98)',
          ]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* TOP HEADER — Account is a tab: it has nowhere to go back to, so it
          shows a title instead of the dead-end back arrow it used to carry. */}
      <View className="h-12 flex-row items-center px-5">
        <RNText className="text-[20px] font-extrabold tracking-[-0.2px] text-ink">
          Account
        </RNText>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: Math.max(insets.bottom, 16) + 18,
        }}
      >
        {/* ACCOUNT — glass card over the single backdrop */}
        <View
          className="h-[78px] overflow-hidden rounded-[18px] border border-white/[0.88]"
          style={{ boxShadow: '0px 4px 10px rgba(58,53,43,0.055)', elevation: 2 }}
        >
          <View className="min-h-[78px] flex-row items-center bg-white/[0.64] px-3">
            <View className="h-[52px] w-[52px] items-center justify-center rounded-full border border-[#F0EEE7] bg-white">
              <Ionicons name="person" size={26} color={BRAND} />
            </View>

            <View className="ml-3 min-w-0 flex-1">
              <RNText
                className="text-[18px] font-extrabold tracking-[-0.2px] text-ink"
                numberOfLines={1}
              >
                {displayName !== '' ? displayName : 'Your account'}
              </RNText>

              <RNText className="mt-[3px] text-[14px] text-ink">
                {user.phone ?? '—'}
              </RNText>
            </View>

            <Pressable
              onPress={() => router.push('/(shop)/edit-profile')}
              accessibilityRole="button"
              accessibilityLabel="Open account"
              hitSlop={8}
              className="h-9 w-[30px] items-center justify-center active:opacity-65"
            >
              <Ionicons name="chevron-forward" size={18} color="#676861" />
            </Pressable>
          </View>
        </View>

        {/* YOUR INFORMATION */}
        <SectionHeading>YOUR INFORMATION</SectionHeading>

        <SectionCard>
          <MenuRow
            icon="receipt-outline"
            iconColor="#8A4D12"
            iconBackground="#FFF1E1"
            label="Your orders"
            onPress={() => router.push('/(shop)/orders')}
          />

          <MenuRow
            icon="heart-outline"
            iconColor="#E14436"
            iconBackground="#FDEDEC"
            label="Your wishlist"
            onPress={() => router.push('/(shop)/wishlist')}
          />

          <MenuRow
            icon="location-outline"
            iconColor={BRAND}
            iconBackground={GREEN_PALE}
            label="Address book"
            onPress={() => router.push('/(shop)/address-book')}
            trailing={<AddressCount />}
          />

          <MenuRow
            icon="person-outline"
            iconColor="#A45A17"
            iconBackground="#FFF1E1"
            label="Edit profile"
            onPress={() => router.push('/(shop)/edit-profile')}
            last
          />
        </SectionCard>

        {/* PREFERENCES */}
        <SectionHeading>PREFERENCES</SectionHeading>

        <SectionCard>
          {/* One row, one destination: "Notification preferences" and "App
              settings" both used to open the same Settings screen. */}
          <MenuRow
            icon="notifications-outline"
            iconColor={BRAND}
            iconBackground={GREEN_PALE}
            label="Notification preferences"
            onPress={() => router.push('/(shop)/settings')}
            last
          />
        </SectionCard>

        {/* SUPPORT */}
        <SectionHeading>SUPPORT</SectionHeading>

        <SectionCard>
          <MenuRow
            icon="help-circle-outline"
            iconColor={BRAND}
            iconBackground={GREEN_PALE}
            label="Help & Support"
            onPress={() => router.push('/(shop)/support')}
          />

          <MenuRow
            icon="document-text-outline"
            iconColor={BRAND}
            iconBackground={GREEN_PALE}
            label="FAQ"
            onPress={() => router.push('/(shop)/support')}
            last
          />
        </SectionCard>

        {/* ACCOUNT */}
        <SectionHeading>ACCOUNT</SectionHeading>

        <SectionCard>
          <MenuRow
            icon="trash-outline"
            iconColor={RED}
            iconBackground={RED_SOFT}
            label="Delete account"
            danger
            onPress={() => router.push('/(shop)/delete-account')}
          />

          <MenuRow
            icon="log-out-outline"
            iconColor={RED}
            iconBackground={RED_SOFT}
            label="Log out"
            danger
            busy={signingOut}
            onPress={() => void handleLogout()}
            last
          />
        </SectionCard>

        <RNText className="mt-[18px] text-center text-[10.5px] text-[#8C8A80]">
          Sakya Farms · Pure food, rooted in tradition
        </RNText>
      </ScrollView>
    </View>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <RNText className="mb-1.5 ml-[11px] mt-3.5 text-[10.5px] font-extrabold tracking-[0.75px] text-[#77736B]">
      {children}
    </RNText>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="overflow-hidden rounded-[13px] border border-[#E9E3D8] bg-white"
      style={{ boxShadow: '0px 2px 6px rgba(58,53,43,0.035)', elevation: 1 }}
    >
      {children}
    </View>
  );
}

function MenuRow({
  icon,
  iconColor,
  iconBackground,
  label,
  message,
  onPress,
  danger = false,
  busy = false,
  trailing,
  last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBackground: string;
  label: string;
  message?: string;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
  trailing?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      className="relative h-12 flex-row items-center px-2.5 active:opacity-[0.58]"
    >
      <View
        className="h-[30px] w-[30px] items-center justify-center rounded-[15px]"
        style={{ backgroundColor: iconBackground }}
      >
        {busy ? (
          <ActivityIndicator
            size="small"
            color={danger ? colors.danger : BRAND}
          />
        ) : (
          <Ionicons
            name={icon}
            size={18}
            color={danger ? colors.danger : iconColor}
          />
        )}
      </View>

      <View className="ml-2.5 min-w-0 flex-1">
        {/* Full class strings in both branches: NativeWind's static extractor
            must see complete class names, not interpolated fragments. */}
        <RNText
          className={
            danger
              ? 'text-[13.5px] font-bold text-danger'
              : 'text-[13.5px] font-bold text-ink'
          }
        >
          {label}
        </RNText>

        {message ? (
          <RNText className="mt-[1px] text-[10.5px] text-[#77736B]">
            {message}
          </RNText>
        ) : null}
      </View>

      {trailing}

      <Ionicons
        name="chevron-forward"
        size={16}
        color={danger ? RED : SUBTLE}
      />

      {!last ? (
        <View
          className="absolute bottom-0 left-[50px] right-0 bg-[#E8E1D5]"
          style={{ height: StyleSheet.hairlineWidth }}
        />
      ) : null}
    </Pressable>
  );
}

function AddressCount() {
  const book = useQuery({
    queryKey: ['addresses'],
    queryFn: addressesApi.list,
    staleTime: 30_000,
  });

  const count = book.data?.addresses.length ?? 0;

  if (book.isPending || count === 0) return null;

  return (
    <RNText className="mr-1.5 text-[12px] font-extrabold text-brand">
      {count}
    </RNText>
  );
}
