import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { journeyApi } from '../../src/api/journey';
import { AuthGate } from '../../src/components/AuthGate';
import { SubScreenHeader } from '../../src/components/navigation/SubScreenHeader';
import { useAuthStore } from '../../src/stores/auth-store';

const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const DANGER = '#B3453E';

/**
 * Account deletion — the DPDP/GDPR right to erasure, with a real warning.
 *
 * Flow: type your phone number to confirm → `DELETE /me/account` (server
 * anonymises the account, revokes every session, keeps order/payment
 * records) → the local session is cleared and the customer lands on Home,
 * signed out. Errors (mismatched phone, already deleted, offline) render
 * verbatim from the server where available.
 */
export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const logout = useAuthStore((state) => state.logout);

  const [confirmPhone, setConfirmPhone] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  if (session === null) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <AuthGate
          icon="person-outline"
          title="Verify your number to manage your account"
          message="Account deletion is personal. Verify your phone to continue."
          redirectTo="/(shop)/delete-account"
        />
      </View>
    );
  }

  const normalised = confirmPhone.replace(/\D/g, '');
  const phoneMatches =
    normalised.length >= 10 &&
    session.user.phone !== null &&
    session.user.phone.replace(/\D/g, '').endsWith(normalised.slice(-10));
  const canDelete = confirmChecked && phoneMatches && !deleting;

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await journeyApi.deleteAccount(confirmPhone.trim(), reason.trim() || undefined);
      await logout();
      router.replace('/(shop)');
    } catch (err) {
      setError(
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'Could not delete your account right now. Try again.',
      );
      setDeleting(false);
    }
  };

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <SubScreenHeader title="Delete account" backDisabled={deleting} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} className="gap-4">
        {/* Warning */}
        <View className="rounded-2xl border p-4" style={{ borderColor: '#E8C9C4', backgroundColor: '#FDF4F2' }}>
          <View className="flex-row items-center gap-2">
            <Ionicons name="warning" size={18} color={DANGER} />
            <RNText className="text-[14px] font-bold" style={{ color: DANGER }}>
              This cannot be undone
            </RNText>
          </View>
          <RNText className="mt-2 text-[12.5px] leading-5" style={{ color: DANGER }}>
            Deleting your account:
            {'\n'}• removes your profile, saved addresses, wishlist and alerts
            {'\n'}• signs you out on this and every other device
            {'\n'}• clears your cart
            {'\n'}• order and payment records are kept as required by law and
            can be requested through support
          </RNText>
        </View>

        {/* Confirm checkbox */}
        <Pressable
          onPress={() => setConfirmChecked((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmChecked }}
          className="flex-row items-center gap-3"
        >
          <Ionicons
            name={confirmChecked ? 'checkbox' : 'square-outline'}
            size={22}
            color={confirmChecked ? DANGER : MUTED}
          />
          <RNText className="flex-1 text-[13px] leading-5" style={{ color: INK }}>
            I understand this permanently deletes my account and personal data.
          </RNText>
        </Pressable>

        {/* Phone confirmation */}
        <View className="gap-1.5">
          <RNText className="text-[12px] font-bold" style={{ color: MUTED }}>
            TYPE YOUR PHONE NUMBER ({session.user.phone ?? ''}) TO CONFIRM
          </RNText>
          <TextInput
            value={confirmPhone}
            onChangeText={setConfirmPhone}
            placeholder="e.g. 98765 43210"
            placeholderTextColor={MUTED}
            keyboardType="phone-pad"
            className="rounded-xl border bg-white px-3.5 py-3 text-[14px]"
            style={{ borderColor: LINE, color: INK }}
            editable={!deleting}
          />
        </View>

        {/* Optional reason */}
        <View className="gap-1.5">
          <RNText className="text-[12px] font-bold" style={{ color: MUTED }}>
            REASON (OPTIONAL — HELPS US IMPROVE)
          </RNText>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Tell us why you are leaving"
            placeholderTextColor={MUTED}
            multiline
            maxLength={500}
            className="rounded-xl border bg-white px-3.5 py-3 text-[14px]"
            style={{ borderColor: LINE, color: INK, minHeight: 80, textAlignVertical: 'top' }}
            editable={!deleting}
          />
        </View>

        {error !== null ? (
          <RNText className="text-[12.5px] font-semibold" style={{ color: DANGER }}>
            {error}
          </RNText>
        ) : null}

        <Pressable
          onPress={() => void handleDelete()}
          disabled={!canDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete my account permanently"
          className="h-12 items-center justify-center rounded-full"
          style={{ backgroundColor: DANGER, opacity: canDelete ? 1 : 0.4 }}
        >
          <RNText className="text-[14px] font-bold text-white">
            {deleting ? 'Deleting…' : 'Delete my account'}
          </RNText>
        </Pressable>
      </ScrollView>
    </View>
  );
}
