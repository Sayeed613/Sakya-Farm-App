import { useState } from 'react';
import {
  Image,
  ImageBackground,
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
const INK_SOFT = '#777B77';
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
========================================================= */

export default function PhoneLoginScreen() {
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const digits = toLocalDigits(phone);
  const canSubmit = digits.length === MAX_DIGITS && !loading;

  /* =======================================================
     SEND OTP → OTP SCREEN
  ======================================================= */

  async function handleSendOtp() {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      /*
       * REAL BACKEND — POST /api/v1/auth/otp/send
       *
       * One endpoint for new and returning customers: the response never
       * reveals whether the phone has an account. Demo builds verify with
       * the fixed demo code; production sends it by SMS via Vonage.
       */
      const result = await authApi.sendOtp(`+91${digits}`);

      // The phone travels to the OTP screen in E.164, already normalised.
      // `devCode` is present only in non-production demo responses; on a
      // production build the param is simply absent.
      router.push({
        pathname: '/(auth)/verify-otp',
        params: result.devCode !== undefined ? { phone: result.phone, devCode: result.devCode } : { phone: result.phone },
      });
    } catch (cause) {
      setError(cause instanceof Error ? friendlyError(cause.message) : 'Something went wrong. Please try again.');
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

      <ImageBackground
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../src/images/login-bg.png')}
        style={{ flex: 1 }}
        resizeMode="cover"
      >
        {/* =================================================
            HERO — OUTSIDE the keyboard-avoiding view.

            The hero never moves, resizes or crops when the
            keyboard opens: the KAV below wraps ONLY the login
            form, so iOS lifts just the sheet while the farm
            scene above stays anchored.
        ================================================= */}

        <View
          className="flex-1 min-h-[190px] items-center px-6 pb-[22px]"
          style={{ paddingTop: insets.top + 36 }}
        >
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../../src/images/sakya-logo-white.png')}
            style={{
              width: 150,
              height: 75,
              tintColor: BRAND,
            }}
            resizeMode="contain"
          />

          <View className="items-center mt-2.5">
            <RNText className="text-hero font-serif text-[17px] leading-6 text-center">
              Pure Goodness
            </RNText>

            <RNText className="text-hero font-serif text-[17px] leading-6 text-center">
              From Our Farms
            </RNText>

            <RNText className="text-hero font-serif text-[17px] leading-6 text-center">
              To Your Home
            </RNText>
          </View>

          <View className="w-full flex-row justify-around items-center mt-[26px]">
            <FeatureItem icon="leaf-outline" firstLine="Natural" secondLine="Products" />
            <FeatureItem icon="heart-outline" firstLine="Healthy" secondLine="Living" />
            <FeatureItem icon="car-outline" firstLine="Farm to" secondLine="Home" />
          </View>
        </View>

        {/* =================================================
            LOGIN FORM — the ONLY keyboard-aware region.

            When the phone field focuses, this area (and only
            this area) lifts above the keyboard. The ScrollView
            is the escape hatch for small screens; the form is
            bottom-anchored so the sheet rides up naturally and
            the Send OTP button is always reachable. The leaves
            live INSIDE the form, so they move with it and can
            never overlap the hero or float over the phone field.
        ================================================= */}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flexShrink: 1 }}
        >
          <ScrollView
            contentContainerStyle={[
              { flexGrow: 1, justifyContent: 'flex-end' },
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
            <View className="relative bg-cream rounded-t-[28px] px-[22px] pt-3 pb-1.5 overflow-hidden">
              <View className="w-11 h-1 rounded-full bg-[#D6D3C8] self-center mb-3.5" />

              {/* HEADING */}

              <View className="mb-[18px]">
                <RNText className="text-ink font-serif text-[30px] leading-[37px] font-semibold">
                  Welcome to Sakya Farms
                </RNText>

                <RNText className="text-ink-soft text-[13.5px] leading-[18px] mt-1.5">
                  Enter your phone number to continue
                </RNText>
              </View>

              {/* PHONE FIELD: fixed +91 prefix, digits only */}

              <View
                className={
                  'h-[54px] flex-row items-center border rounded-[14px] bg-[#FCFBF6] px-3.5' +
                  (error ? ' border-danger' : ' border-line')
                }
              >
                <View className="flex-row items-center gap-1 pr-2.5">
                  <RNText className="text-ink text-[15px] font-semibold">+91</RNText>
                  <View className="w-px h-5 bg-line" />
                </View>

                <TextInput
                  className="flex-1 text-ink text-[15px] tracking-[1px]"
                  placeholder="Enter phone number"
                  placeholderTextColor={INK_SOFT}
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
                  accessibilityLabel="Phone number"
                  accessibilityHint="We will text you a verification code"
                />
              </View>

              {/* ERROR */}

              {error ? (
                <View className="flex-row items-center gap-[7px] px-0.5 mt-2">
                  <Ionicons name="alert-circle-outline" size={18} color={DANGER} />
                  <RNText className="flex-1 text-danger text-xs leading-[17px]">{error}</RNText>
                </View>
              ) : null}

              {/* SEND OTP */}

              <Pressable
                onPress={() => void handleSendOtp()}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel="Send OTP to this phone number"
                accessibilityState={{ disabled: !canSubmit, busy: loading }}
                className={
                  'h-[50px] rounded-full bg-brand items-center justify-center mt-4' +
                  (!canSubmit ? ' opacity-55' : '')
                }
                style={({ pressed }) =>
                  pressed && canSubmit ? { transform: [{ scale: 0.985 }] } : undefined
                }
              >
                {loading ? (
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="sync-outline" size={20} color="#FFFFFF" />
                    <RNText className="text-white text-[15px] font-bold tracking-[0.1px]">
                      Sending OTP...
                    </RNText>
                  </View>
                ) : (
                  <RNText className="text-white text-[15px] font-bold tracking-[0.1px]">
                    Send OTP
                  </RNText>
                )}
              </Pressable>

              {/* TRUST LINE — no sign-up concept, no password, ever */}

              <RNText className="text-ink-soft text-[11.5px] leading-4 text-center mt-3 mb-4 px-6">
                By continuing you agree to our terms. New here? You will be
                signed in automatically — no password needed.
              </RNText>

              <Image
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                source={require('../../src/images/auth-bottom-leaves.png')}
                style={{
                  position: 'absolute',
                  left: -12,
                  bottom: -20,
                  width: 110,
                  height: 110,
                  opacity: 0.95,
                }}
                resizeMode="contain"
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ImageBackground>
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

/* =============================================================
   FEATURE ITEM
============================================================= */

type FeatureItemProps = {
  icon: keyof typeof Ionicons.glyphMap;
  firstLine: string;
  secondLine: string;
};

function FeatureItem({ icon, firstLine, secondLine }: FeatureItemProps) {
  return (
    <View className="min-w-[76px] items-center">
      <View className="w-[46px] h-[46px] items-center justify-center mb-1.5 rounded-full bg-[#142819]/35">
        <Ionicons name={icon} size={23} color="#FFFFFF" />
      </View>

      <RNText className="text-hero text-xs leading-4 font-medium text-center">{firstLine}</RNText>

      <RNText className="text-hero text-xs leading-4 font-medium text-center">{secondLine}</RNText>
    </View>
  );
}
