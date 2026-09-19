import { useState } from 'react';
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

import { requireApiClient } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/auth-store';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E7E4DA';
const DANGER = '#B42318';

/**
 * "Tell us a little about you" — optional profile completion.
 *
 * This is NOT sign-up: the account was created at OTP verification and the
 * session is already live. The only ask is a first name; email is optional and
 * the whole screen can be skipped with no consequence — checkout does not
 * require it. Deliberately absent: passwords, address entry, marketing
 * checkboxes, anything that looks like a registration form.
 */
export default function CompleteProfileScreen() {
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ from?: string }>();
  // Preserved destination across the profile step, so completing the flow
  // still returns the customer to checkout (or wherever the gate caught them).
  const redirectTo = typeof params.from === 'string' && params.from.length > 0 ? params.from : null;

  const session = useAuthStore((state) => state.session);
  const pendingRedirect = useAuthStore((state) => state.pendingRedirect);

  const [firstName, setFirstName] = useState(session?.user.firstName === 'Customer' ? '' : session?.user.firstName ?? '');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function destination() {
    return redirectTo ?? pendingRedirect ?? '/(shop)';
  }

  async function submit() {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const trimmed = firstName.trim();
      const trimmedEmail = email.trim();

      // Server-side update; nothing here is required for authentication.
      if (trimmed.length > 0 || trimmedEmail.length > 0) {
        await requireApiClient().http.request('/users/me', {
          method: 'PATCH',
          body: {
            ...(trimmed.length > 0 ? { firstName: trimmed } : {}),
            ...(trimmedEmail.length > 0 ? { email: trimmedEmail } : {}),
          },
        });

        // Keep the stored session's user in sync with the new profile.
        const current = useAuthStore.getState().session;
        if (current) {
          await useAuthStore.getState().setSession({
            ...current,
            isNewUser: false,
          });
        }
      }

      router.replace(destination());
      useAuthStore.getState().setPendingRedirect(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        message.toLowerCase().includes('already exists')
          ? 'That email is already on another account. Try another one, or leave email empty.'
          : 'Could not save your details. You can continue anyway.',
      );
    } finally {
      setLoading(false);
    }
  }

  /** Skipping is a first-class action: the session works without a profile. */
  function skip() {
    router.replace(destination());
    useAuthStore.getState().setPendingRedirect(null);
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
              <Ionicons name="person-outline" size={24} color={BRAND} />
            </View>

            <RNText className="text-ink font-serif text-[26px] leading-[32px] font-semibold text-center">
              Tell us a little about you
            </RNText>

            <RNText className="text-ink-soft text-[13.5px] leading-5 text-center mt-2 px-4">
              Your number is verified and you are signed in. Add a name so
              deliveries feel personal — or skip it.
            </RNText>
          </View>

          {/* FIRST NAME */}

          <View className="gap-4">
            <View className="gap-1.5">
              <RNText className="text-[12px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                First name
              </RNText>
              <TextInput
                className="h-[50px] border rounded-[14px] bg-[#FCFBF6] px-3.5 text-[15px]"
                style={{ borderColor: LINE, color: INK }}
                placeholder="e.g. Ananya"
                placeholderTextColor={MUTED}
                value={firstName}
                onChangeText={(value) => {
                  setFirstName(value);
                  if (error) setError(null);
                }}
                editable={!loading}
                returnKeyType="next"
                selectionColor={BRAND}
                cursorColor={BRAND}
                accessibilityLabel="First name"
              />
            </View>

            {/* EMAIL — explicitly optional */}

            <View className="gap-1.5">
              <View className="flex-row items-center gap-2">
                <RNText className="text-[12px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                  Email
                </RNText>
                <RNText className="text-[11px] font-semibold" style={{ color: MUTED }}>
                  (optional)
                </RNText>
              </View>
              <TextInput
                className="h-[50px] border rounded-[14px] bg-[#FCFBF6] px-3.5 text-[15px]"
                style={{ borderColor: LINE, color: INK }}
                placeholder="you@example.com"
                placeholderTextColor={MUTED}
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  if (error) setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={() => void submit()}
                selectionColor={BRAND}
                cursorColor={BRAND}
                accessibilityLabel="Email, optional"
              />
            </View>

            {/* ERROR */}

            {error ? (
              <View className="flex-row items-center gap-[7px] px-0.5">
                <Ionicons name="alert-circle-outline" size={17} color={DANGER} />
                <RNText className="flex-1 text-danger text-[13px] leading-[18px]">{error}</RNText>
              </View>
            ) : null}

            {/* CONTINUE */}

            <Pressable
              onPress={() => void submit()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Save and continue"
              accessibilityState={{ disabled: loading, busy: loading }}
              className={
                'h-[50px] rounded-full bg-brand items-center justify-center mt-2' +
                (loading ? ' opacity-55' : '')
              }
              style={({ pressed }) =>
                pressed && !loading ? { transform: [{ scale: 0.985 }] } : undefined
              }
            >
              {loading ? (
                <View className="flex-row items-center gap-2">
                  <Ionicons name="sync-outline" size={20} color="#FFFFFF" />
                  <RNText className="text-white text-[15px] font-bold">Saving...</RNText>
                </View>
              ) : (
                <RNText className="text-white text-[15px] font-bold">Continue</RNText>
              )}
            </Pressable>

            {/* SKIP */}

            <Pressable
              onPress={skip}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Skip profile completion"
              className="items-center py-2"
              hitSlop={8}
            >
              <RNText className="text-[13.5px] font-semibold" style={{ color: MUTED }}>
                Skip for now
              </RNText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
