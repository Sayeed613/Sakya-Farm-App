import { Image } from 'expo-image';
import { useCallback, useMemo } from 'react';
import { View, Pressable, Text as RNText } from 'react-native';
import { router } from 'expo-router';

export default function HomeFooter() {
  const openRoute = useCallback((route: string) => router.push(route), []);

  const links = useMemo(() => {
    return [
      { label: 'Shop All', route: '/(shop)/categories' },
      { label: 'Sakya Fresh', route: '/(shop)/fresh' },
      { label: 'My Orders', route: '/(shop)/orders' },
      { label: 'Wishlist', route: '/(shop)/wishlist' },
      { label: 'Help & Support', route: '/(shop)/support' },
    ];
  }, []);

  return (
    <View className="mt-12 overflow-hidden rounded-t-3xl bg-brand/5 px-6 pb-10 pt-8">
      {/* Wordmark row: the real logo asset, tinted brand green. */}
      <View className="items-center">
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../../../src/images/sakya-logo-white.png')}
          style={{ width: 104, height: 52, tintColor: '#0B594C' }}
          contentFit="contain"
          cachePolicy="memory"
          accessibilityLabel="Sakya Farms"
        />
        <RNText className="mt-2 text-center text-[12px] leading-5 text-ink-soft">
          Pure food. Rooted in tradition.
        </RNText>
      </View>

      {/* Real navigation links — every route is a live screen. */}
      <View className="mt-6 flex-row flex-wrap justify-center gap-x-5 gap-y-2">
        {links.map((link) => (
          <Pressable
            key={link.route}
            onPress={() => openRoute(link.route)}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            hitSlop={6}
          >
            <RNText className="text-[12.5px] font-semibold text-brand">{link.label}</RNText>
          </Pressable>
        ))}
      </View>

      <View className="mt-6 items-center gap-1">
        <RNText className="text-[11px] text-ink-soft">
          Farm-direct · Packed at source · Delivered fresh
        </RNText>
        <RNText className="text-[10px] tracking-wide text-ink-soft/70">
          © {new Date().getFullYear()} Sakya Farms. All rights reserved.
        </RNText>
      </View>
    </View>
  );
}