import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi } from '../../src/api/auth';

const BRAND = '#0B594C';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const DANGER = '#B42318';

/** Longest Indian mobile number a user can type, minus formatting. */
const MAX_DIGITS = 10;

/**
 * Keep only digits so the field cannot hold letters; the `+91` is display-only.
 * Strips country codes people paste and the leading 0 of a trunk prefix.
 */
function toLocalDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const withoutCountry = digits.replace(/^91(?=\d{10}$)/, '');
  return withoutCountry.replace(/^0(?=\d{10}$)/, '').slice(0, MAX_DIGITS);
}

/* =========================================================
   PHONE LOGIN — the only sign-in the customer app has

   Deliberately one screen, one task: enter a number, get a
   code. The previous version was a marketing landing page
   (farm hero, tagline, three feature bubbles, decorative
   leaves) with the actual field buried in a bottom sheet —
   slow to scan and it pushed the real action off small
   screens. This is the same real API with the noise removed.
========================================================= */

export default function PhoneLoginScreen() {
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const digits = toLocalDigits(phone);
  const canSubmit = digits.length === MAX_DIGITS && !loading;

  async function handleSendOtp() {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      /*
       * REAL BACKEND — POST /api/v1/auth/otp/send
       *
       * One endpoint for new and returning customers: the response never
       * reveals whether the phone has an account. Demo builds verify with a
       * fixed code; production sends it by SMS.
       */
      const result = await authApi.sendOtp(`+91${digits}`);

      // The phone travels to the OTP screen in E.164, already normalised.
      // `devCode` is present only in non-production demo responses; on a
      // production build the param is simply absent, and the OTP screen then
      // expects the production 6-digit length.
      router.push({
        pathname: '/(auth)/verify-otp',
        params:
          result.devCode !== undefined
            ? { phone: result.phone, devCode: result.devCode }
            : { phone: result.phone },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? friendlyError(cause.message) : 'Something went wrong. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  function handlePhoneChange(value: string) {
    setPhone(toLocalDigits(value));
    if (error) setError(null);
  }

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 24,
            paddingTop: insets.top + 24,
            paddingBottom: Math.max(insets.bottom, 24),
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full self-center" style={{ maxWidth: 420 }}>
            {/* BRAND */}
            <View className="items-center">
              <Image
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                source={require('../../src/images/sakya-logo-white.png')}
                style={{ width: 132, height: 66, tintColor: BRAND }}
                resizeMode="contain"
                accessibilityLabel="Sakya Farms"
              />
            </View>

            {/* HEADING */}
            <View className="mt-6">
              <RNText className="text-ink font-serif text-[27px] leading-[34px] font-semibold">
                Welcome to Sakya Farms
              </RNText>
              <RNText className="text-ink-soft text-[13.5px] leading-[19px] mt-2">
                Enter your mobile number and we will text you a one-time code. No password, ever.
              </RNText>
            </View>

            {/* PHONE FIELD: fixed +91 prefix, digits only */}
            <View className="mt-7">
              <RNText className="text-[12px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                Mobile number
              </RNText>

              <View
                className={
                  'mt-2 h-[54px] flex-row items-center border rounded-[14px] bg-[#FCFBF6] px-3.5' +
                  (error ? ' border-danger' : ' border-line')
                }
              >
                <View className="flex-row items-center gap-2.5 pr-3">
                  <RNText className="text-ink text-[15px] font-semibold">+91</RNText>
                  <View className="w-px h-5" style={{ backgroundColor: LINE }} />
                </View>

                <TextInput
                  className="flex-1 text-ink text-[15px] tracking-[1px]"
                  placeholder="98765 43210"
                  placeholderTextColor={MUTED}
                  value={digits}
                  onChangeText={handlePhoneChange}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  maxLength={MAX_DIGITS}
                  editable={!loading}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (canSubmit) void handleSendOtp();
                  }}
                  selectionColor={BRAND}
                  cursorColor={BRAND}
                  accessibilityLabel="Mobile number"
                  accessibilityHint="We will text you a verification code"
                />
              </View>
            </View>

            {/* ERROR */}
            {error ? (
              <View className="flex-row items-center gap-[7px] px-0.5 mt-2.5">
                <Ionicons name="alert-circle-outline" size={18} color={DANGER} />
                <RNText className="flex-1 text-danger text-xs leading-[17px]">{error}</RNText>
              </View>
            ) : null}

            {/* SEND OTP */}
            <Pressable
              onPress={() => void handleSendOtp()}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Send one-time code to this mobile number"
              accessibilityState={{ disabled: !canSubmit, busy: loading }}
              className={
                'h-[52px] rounded-[14px] bg-brand items-center justify-center mt-5' +
                (!canSubmit ? ' opacity-55' : '')
              }
              style={({ pressed }) => (pressed && canSubmit ? { transform: [{ scale: 0.985 }] } : undefined)}
            >
              {loading ? (
                <View className="flex-row items-center gap-2">
                  <Ionicons name="sync-outline" size={20} color="#FFFFFF" />
                  <RNText className="text-white text-[15px] font-bold tracking-[0.1px]">
                    Sending code…
                  </RNText>
                </View>
              ) : (
                <RNText className="text-white text-[15px] font-bold tracking-[0.1px]">
                  Send one-time code
                </RNText>
              )}
            </Pressable>

            {/* TRUST LINE — no sign-up concept, no password, ever */}
            <RNText className="text-ink-soft text-[11.5px] leading-4 text-center mt-4 px-4">
              New here? Your account is created automatically the first time you verify.
            </RNText>

            <RNText className="text-ink-soft text-[11.5px] leading-4 text-center mt-1 px-4">
              Standard SMS rates may apply.
            </RNText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Map transport/service failures to what a customer should read. */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('too many') || lower.includes('wait')) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('aborted')) {
    return 'Unable to connect. Please check your connection and try again.';
  }
  if (lower.includes('valid phone')) {
    return 'Please enter a valid 10-digit Indian mobile number.';
  }
  return 'Could not send the code. Please try again in a moment.';
}
