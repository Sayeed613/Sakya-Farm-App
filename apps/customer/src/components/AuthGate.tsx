import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text as RNText, View } from 'react-native';

import { useAuthStore } from '../stores/auth-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

export interface AuthGateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  /**
   * The route to return to once authenticated, e.g. `/(shop)/checkout`.
   * Captured when the customer taps "Continue", so authentication never dumps
   * them at Home — they land exactly where they were heading.
   */
  redirectTo: string;
}

/**
 * The customer auth gate.
 *
 * Browsing is open; personal surfaces (checkout, orders, account) are not.
 * Rendering this block instead of the screen preserves the intended
 * destination in the auth store, and the OTP flow returns the customer here
 * after merging the guest cart.
 */
export function AuthGate({ icon, title, message, redirectTo }: AuthGateProps) {
  const setPendingRedirect = useAuthStore((state) => state.setPendingRedirect);

  function handleContinue() {
    setPendingRedirect(redirectTo);
    router.push('/(auth)/phone');
  }

  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-brand/10">
        <Ionicons name={icon} size={28} color={BRAND} />
      </View>

      <RNText className="text-center text-[16px] font-bold" style={{ color: INK }}>
        {title}
      </RNText>

      <RNText className="text-center text-[13.5px] leading-5" style={{ color: MUTED }}>
        {message}
      </RNText>

      <Pressable
        onPress={handleContinue}
        accessibilityRole="button"
        accessibilityLabel="Continue with phone number"
        className="mt-2 rounded-full px-7 py-3"
        style={{ backgroundColor: BRAND }}
      >
        <RNText className="text-[14px] font-bold text-white">Continue with phone</RNText>
      </Pressable>
    </View>
  );
}
