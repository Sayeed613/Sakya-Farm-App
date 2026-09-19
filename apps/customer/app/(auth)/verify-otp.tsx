import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authApi } from '../../src/api/auth';
import { useAuthStore } from '../../src/stores/auth-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E7E4DA';
const DANGER = '#B42318';

const CODE_LENGTH = 4;
/** Matches the API's resend cooldown. */
const RESEND_SECONDS = 60;

/** `+919876543210` → `+91 XXXXX XXXXX` for the subtitle. */
function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/^\+91/, '');
  if (digits.length !== 10) return phone;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * OTP verification — the authentication event itself.
 *
 * Existing customer: verifies and signs in. New phone: the server creates the
 * account during the same call, so the screen is identical for both — no
 * sign-up, no password, no branching until the optional profile step.
 *
 * 4-digit code per the demo OTP contract (the server's schema accepts the
 * demo length; production issues 6-digit codes and the server validates the
 * active length — this screen matches the demo build it ships in).
 *
 * The `devCode` chip appears only when the API reported the code in its
 * response — which happens exclusively in non-production demo mode. On a
 * production build the field is absent and the chip never renders.
 */
export default function VerifyOtpScreen() {
  const insets = useSafeAreaInsets();
  const setSession = useAuthStore((state) => state.setSession);
  const pendingRedirect = useAuthStore((state) => state.pendingRedirect);

  const params = useLocalSearchParams<{ phone?: string; devCode?: string }>();
  // The phone arrives E.164-normalised from the send step. A missing value
  // (deep link, back-nav) sends the user to the phone screen rather than
  // verifying an unknown number.
  const phone = typeof params.phone === 'string' && params.phone.startsWith('+') ? params.phone : null;
  const [demoCode, setDemoCode] = useState(
    typeof params.devCode === 'string' && /^\d+$/.test(params.devCode) ? params.devCode : null,
  );

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);

  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (phone === null) {
      router.replace('/(auth)/phone');
    }
  }, [phone]);

  // Resend cooldown ticks only while the user is here.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const canSubmit = code.length === CODE_LENGTH && !loading && phone !== null;

  const subtitle = useMemo(
    () => (phone === null ? '' : formatPhoneForDisplay(phone)),
    [phone],
  );

  async function handleVerify(otp: string) {
    if (phone === null || loading) return;

    setLoading(true);
    setError(null);

    try {
      const session = await authApi.verifyOtp(phone, otp);
      // Persist session + merge the guest cart (server revalidates prices,
      // availability, stock and the fulfillment store).
      await setSession(session);

      // NEW CUSTOMER → optional, minimal profile completion. Not a sign-up:
      // the account exists and is authenticated already.
      if (session.isNewUser && session.user.firstName === 'Customer') {
        router.replace('/(auth)/complete-profile');
        return;
      }

      // Intended destination, or the shop. Never dumps the user at Home.
      router.replace(pendingRedirect ?? '/(shop)');
      useAuthStore.getState().setPendingRedirect(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (message.toLowerCase().includes('too many') || message.toLowerCase().includes('wait')) {
        setError('Too many attempts. Please wait before trying again.');
      } else {
        // Generic on purpose: wrong code, expired code and unknown code read
        // the same, matching the server.
        setError('That code did not match. Please check and try again.');
      }
      setCode('');
      // Re-focus so retyping is immediate.
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  function handleChange(value: string) {
    // Digits only; a paste longer than the code is trimmed to its first
    // digits, which is also what makes SMS autofill "just work".
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);

    // Auto-verify once every box is filled — the expected mobile behaviour.
    if (digits.length === CODE_LENGTH) {
      void handleVerify(digits);
    }
  }

  async function handleResend() {
    if (phone === null || resendIn > 0 || loading) return;

    setError(null);
    try {
      const result = await authApi.sendOtp(phone);
      setDemoCode(result.devCode ?? null);
      setResendIn(RESEND_SECONDS);
      setCode('');
      inputRef.current?.focus();
    } catch {
      setError('Could not resend the code. Please wait a moment and try again.');
    }
  }

  if (phone === null) {
    return <View className="flex-1 bg-cream" />;
  }

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 24,
            paddingBottom: Math.max(insets.bottom, 24),
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}

          <View className="items-center mb-8">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-brand/10 mb-4">
              <Ionicons name="chatbubble-ellipses-outline" size={26} color={BRAND} />
            </View>

            <RNText className="text-ink font-serif text-[26px] leading-[32px] font-semibold text-center">
              Verify your number
            </RNText>

            <RNText className="text-ink-soft text-[14px] leading-5 text-center mt-2">
              Enter the {CODE_LENGTH}-digit code sent to {subtitle}
            </RNText>
          </View>

          {/* DEMO CODE CHIP — rendered only when the API reported the code,
              i.e. non-production demo builds. Never on a production build. */}

          {demoCode !== null ? (
            <View className="self-center flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 mb-5" style={{ backgroundColor: '#EEF7ED' }}>
              <Ionicons name="information-circle-outline" size={15} color={BRAND} />
              <RNText className="text-[12px] font-bold" style={{ color: BRAND }}>
                Demo mode — use code {demoCode}
              </RNText>
            </View>
          ) : null}

          {/* CODE INPUT */}

          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessibilityLabel="Verification code input"
            className="items-center"
          >
            <View className="flex-row justify-center gap-2.5">
              {Array.from({ length: CODE_LENGTH }, (_, index) => {
                const digit = code[index] ?? '';
                const isActive = index === code.length && !loading;
                return (
                  <View
                    key={index}
                    className={
                      'h-[52px] w-[44px] items-center justify-center rounded-[12px] border bg-[#FCFBF6]' +
                      (error
                        ? ' border-danger'
                        : isActive
                          ? ' border-brand border-2'
                          : ' border-line')
                    }
                  >
                    <RNText className="text-[22px] font-bold" style={{ color: INK }}>
                      {digit}
                    </RNText>
                  </View>
                );
              })}
            </View>
          </Pressable>

          {/* Hidden real input: drives the visible boxes, the keyboard, SMS
              autofill and paste. Every mutation flows through handleChange. */}
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={handleChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={CODE_LENGTH}
            autoFocus
            editable={!loading}
            style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
            accessibilityLabel={`${CODE_LENGTH}-digit verification code`}
          />

          {/* ERROR */}

          {error ? (
            <View className="flex-row items-center justify-center gap-[7px] mt-5">
              <Ionicons name="alert-circle-outline" size={17} color={DANGER} />
              <RNText className="text-danger text-[13px] leading-[18px]">{error}</RNText>
            </View>
          ) : null}

          {/* RESEND */}

          <View className="flex-row items-center justify-center gap-1 mt-6">
            {resendIn > 0 ? (
              <RNText className="text-ink-soft text-[13.5px]">
                Resend code in 0:{String(resendIn).padStart(2, '0')}
              </RNText>
            ) : (
              <Pressable
                onPress={() => void handleResend()}
                accessibilityRole="button"
                accessibilityLabel="Resend verification code"
                hitSlop={8}
              >
                <RNText className="text-brand text-[13.5px] font-bold">Resend OTP</RNText>
              </Pressable>
            )}
          </View>

          {/* VERIFY (fallback for keyboards that swallow auto-submit) */}

          <Pressable
            onPress={() => void handleVerify(code)}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Verify and sign in"
            accessibilityState={{ disabled: !canSubmit, busy: loading }}
            className={
              'h-[50px] rounded-full bg-brand items-center justify-center mt-8' +
              (!canSubmit ? ' opacity-55' : '')
            }
            style={({ pressed }) =>
              pressed && canSubmit ? { transform: [{ scale: 0.985 }] } : undefined
            }
          >
            {loading ? (
              <View className="flex-row items-center gap-2">
                <Ionicons name="sync-outline" size={20} color="#FFFFFF" />
                <RNText className="text-white text-[15px] font-bold">Verifying...</RNText>
              </View>
            ) : (
              <RNText className="text-white text-[15px] font-bold">Verify & Continue</RNText>
            )}
          </Pressable>

          {/* CHANGE NUMBER */}

          <Pressable
            onPress={() => router.replace('/(auth)/phone')}
            accessibilityRole="button"
            accessibilityLabel="Use a different phone number"
            className="items-center mt-5"
            hitSlop={8}
          >
            <RNText className="text-[13px] font-semibold" style={{ color: MUTED }}>
              Wrong number? <RNText style={{ color: BRAND }}>Change it</RNText>
            </RNText>
          </Pressable>

          <View className="h-6" style={{ borderTopColor: LINE }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
