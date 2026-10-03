import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { formatMoney } from '../../../src/lib/format';
import { useAuthStore } from '../../../src/stores/auth-store';
import { useGuestCartStore } from '../../../src/stores/guest-cart-store';

import CartBackdrop from './CartBackdrop';
import CartHeaderBar from './CartHeaderBar';

const SUBTLE = '#8C8A80';
/** Filled stepper + savings rows. Deliberately lighter than BRAND. */
const GREEN = '#1F7A43';
/** Editorial copy over the header artwork. */
const HERO_GREEN = '#094A3C';

/**
 * Guest cart.
 *
 * Guests can add items before signing in — the pill and the product steppers
 * write to the local guest store. This screen used to replace that cart with a
 * "Verify your number" gate, so items a guest had just added became invisible
 * and uneditable until they signed in. Here the real local cart renders with
 * working quantity and remove controls.
 *
 * Totals are display-only: unit prices are captured from catalog data at add
 * time. The server recomputes the authoritative total when the guest cart is
 * merged at sign-in, which is exactly why the total is labelled "estimated".
 */
export default function GuestCartScreen() {
  const insets = useSafeAreaInsets();
  const lines = useGuestCartStore((state) => state.lines);
  const priceTotals = useGuestCartStore((state) => state.priceTotals);
  const setQuantity = useGuestCartStore((state) => state.setQuantity);
  const removeLine = useGuestCartStore((state) => state.removeLine);

  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const estimated = lines.reduce(
    (sum, line) => sum + (priceTotals[line.variantId] ?? 0) * line.quantity,
    0,
  );

  function signIn() {
    useAuthStore.getState().setPendingRedirect('/(shop)/cart');
    router.push('/(auth)/phone');
  }

  if (lines.length === 0) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <CartBackdrop />
        <CartHeaderBar count={0} />
        <View className="flex-1 items-center justify-center pb-16">
          <EmptyState
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            image={require('../../../src/assets/empty-cart.png')}
            title="Your cart is empty"
            message="Add something fresh and it will show up here."
            ctaLabel="Start shopping"
            onCta={() => router.push('/(shop)')}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <CartBackdrop />
      <CartHeaderBar count={itemCount} />

      <View className="px-4 pt-5 pb-2">
        <RNText className="font-serif text-[23px] leading-[28px] font-bold" style={{ color: HERO_GREEN }}>
          {'Good food\nbrings good days'}
        </RNText>
        <RNText className="mt-1.5 text-[12px] font-semibold" style={{ color: HERO_GREEN }}>
          Sign in to place your order.
        </RNText>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 2 }}
      >
        {lines.map((line) => {
          const title = line.display?.productTitle ?? 'Farm product';
          const variant = line.display?.variantTitle ?? '';
          const unit = priceTotals[line.variantId] ?? 0;
          return (
            <View
              key={line.variantId}
              className="mx-3 mt-3 rounded-[16px] bg-white p-3"
              style={{ boxShadow: '0px 2px 6px rgba(58,53,43,0.05)', elevation: 1 }}
            >
              <View className="flex-row gap-3">
                <View className="h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-[12px] bg-[#F3EDE3]">
                  {line.display?.imageUrl ? (
                    <Image
                      source={{ uri: line.display.imageUrl }}
                      style={{ width: 76, height: 76 }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={line.variantId}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <Ionicons name="leaf-outline" size={22} color={SUBTLE} />
                  )}
                </View>

                <View className="min-w-0 flex-1">
                  <View className="flex-row items-start">
                    <View className="min-w-0 flex-1 pr-2">
                      <RNText numberOfLines={2} className="text-[13.5px] leading-[18px] font-bold text-ink">
                        {title}
                      </RNText>
                      {variant !== '' ? (
                        <RNText numberOfLines={1} className="mt-0.5 text-[11.5px] leading-[15px] text-[#6F6C63]">
                          {variant}
                        </RNText>
                      ) : null}
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${title}`}
                      hitSlop={8}
                      onPress={() => removeLine(line.variantId)}
                      className="active:opacity-60"
                    >
                      <Ionicons name="trash-outline" size={18} color={SUBTLE} />
                    </Pressable>
                  </View>

                  <View className="mt-2 flex-row items-center justify-between">
                    <RNText className="text-[14px] font-extrabold text-ink">
                      {unit > 0 ? formatMoney(unit * line.quantity) : '—'}
                    </RNText>

                    <View
                      className="h-[34px] min-w-[104px] flex-row items-center justify-between rounded-full px-1.5"
                      style={{ backgroundColor: GREEN }}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Decrease quantity"
                        hitSlop={6}
                        onPress={() => setQuantity(line.variantId, line.quantity - 1)}
                        className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
                      >
                        <RNText className="text-[19px] leading-[23px] font-bold text-white">−</RNText>
                      </Pressable>

                      <RNText className="min-w-[20px] text-center text-[14px] font-extrabold text-white">
                        {line.quantity}
                      </RNText>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Increase quantity"
                        hitSlop={6}
                        onPress={() => setQuantity(line.variantId, line.quantity + 1)}
                        className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
                      >
                        <RNText className="text-[19px] leading-[23px] font-bold text-white">+</RNText>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View className="px-3 pt-2">
        <View className="mt-3 rounded-[16px] bg-white px-4 py-3.5">
          <View className="flex-row items-center justify-between">
            <RNText className="text-[13px] text-[#6F6C63]">
              {`Estimated total (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`}
            </RNText>
            <RNText className="text-[15px] font-extrabold text-ink">
              {estimated > 0 ? formatMoney(estimated) : '—'}
            </RNText>
          </View>
          <RNText className="mt-1.5 text-[11px] leading-4 text-[#8C8A80]">
            Final prices, taxes and delivery are calculated on the server after you sign in.
          </RNText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in to checkout"
          onPress={signIn}
          className="mt-3 h-[52px] w-full flex-row items-center justify-center gap-2 rounded-[16px] bg-brand active:opacity-85"
          style={{ marginBottom: Math.max(insets.bottom, 10) }}
        >
          <RNText className="text-[16px] font-bold text-white">Sign in to checkout</RNText>
          <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}