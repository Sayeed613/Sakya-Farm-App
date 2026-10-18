import { useCallback, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, Text as RNText, View } from 'react-native';
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
    <View className="fixed inset-x-0 bottom-0 z-50">
      <View className="mx-auto max-w-(--width-xl) rounded-3xl border border-boundary/10 bg-boundary px-5 py-4 shadow-[0_-12px_34px_rgba(11,89,76,0.16)]">
        {/* Wordmark row: the real Sakya Farms logo, tinted brand green. */}
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-2">
            <Image
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              source={require('../../../../src/images/sakya logo.avif')}
              style={{ width: 44, height: 22, tintColor: '#0B594C' }}
              contentFit="contain"
              cachePolicy="memory"
              accessibilityLabel="Sakya Farms"
            />
            <RNText className="text-[12.5px] font-semibold" style={{ color: '#1D2119' }}>
              Sakya Farms
            </RNText>
          </View>

          {/* Inline quick actions keep the band useful on every tap. */}
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => router.push('/(shop)/cart')}
              accessibilityRole="button"
              accessibilityLabel="Cart"
              className="flex-row items-center gap-1.5 rounded-full bg-[#EAF3EE] px-3.5 py-1.5"
            >
              <Ionicons name="cart" size={15} color="#0B594C" />
              <RNText className="text-[11px] font-semibold" style={{ color: '#0B594C' }}>
                Cart
              </RNText>
            </Pressable>
          <Pressable
              onPress={() => router.push('/(shop)/orders')}
              accessibilityRole="button"
              accessibilityLabel="My orders"
              hitSlop={6}
              className="flex-row items-center gap-1.5 rounded-full bg-[#EAF3EE] px-3.5 py-1.5"
            >
              <Ionicons name="calendar-outline" size={15} color="#0B594C" />
              <RNText className="text-[11px] font-semibold" style={{ color: '#0B594C' }}>
                Orders
              </RNText>
            </Pressable>
          </View>
        </View>

        {/* Real navigation links — every route is a live screen. */}
        <View className="mt-3.5 flex-row flex-wrap justify-center gap-x-5 gap-y-1.5">
          {links.map((link) => (
            <Pressable
              key={link.route}
              onPress={() => openRoute(link.route)}
              accessibilityRole="link"
              accessibilityLabel={link.label}
              hitSlop={6}
            >
              <RNText className="text-[12.5px] font-semibold" style={{ color: '#1D2119' }}>
                {link.label}
              </RNText>
            </Pressable>
          ))}
        </View>

        <View className="mt-2.5 flex-row items-center justify-between gap-2">
          <RNText className="text-[11px] leading-4" style={{ color: '#68736E' }}>
            Farm-direct · Packed at source · Delivered fresh
          </RNText>
          <RNText className="text-[10.5px] tracking-wide" style={{ color: '#8B9488' }}>
            © {new Date().getFullYear()} Sakya Farms. All rights reserved.
          </RNText>
        </View>
      </View>
    </View>
  );
}