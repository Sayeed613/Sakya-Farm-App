import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, TextInput, View } from 'react-native';

import { cartApi } from '../../api/cart';
import { colors } from '../../theme';
import type { AppliedCouponResponse, CartResponse } from '@sakya/types';

/**
 * Coupon box — the ONLY place a coupon can be applied or removed.
 *
 * Everything is server-authoritative: the code goes to `POST /cart/coupon`,
 * the server validates existence, window, usage limits, per-user limits and
 * the minimum order, and the returned cart carries the new totals verbatim.
 * Errors from the API (invalid code, expired, minimum not met, per-user limit)
 * surface as the API's own message — the client never guesses why a coupon
 * failed.
 *
 * Rendering note: this component is embedded in the cart's COUPONS card,
 * which already supplies the surface (white card + hairline + shadow). The
 * box itself therefore carries NO card chrome — only the inner field row
 * (filled input style) and the applied-coupon state.
 */
export function CouponBox({ coupon }: { coupon: AppliedCouponResponse | null }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = useMutation({
    mutationFn: () => cartApi.applyCoupon(code.trim()),
    onSuccess: (data: CartResponse) => {
      queryClient.setQueryData(['cart'], data);
      setCode('');
      setError(null);
    },
    onError: (err: Error) => {
      setError(friendlyMessage(err));
    },
  });

  const remove = useMutation({
    mutationFn: () => cartApi.removeCoupon(),
    onSuccess: (data: CartResponse) => {
      queryClient.setQueryData(['cart'], data);
      setError(null);
    },
  });

  if (coupon !== null) {
    return (
      <View style={styles.appliedCard}>
        <View style={styles.appliedIcon}>
          <Ionicons name="ticket" size={16} color={colors.success} />
        </View>

        <View style={styles.appliedText}>
          <RNText style={styles.appliedCode}>{coupon.code}</RNText>
          <RNText style={styles.appliedDesc} numberOfLines={1}>
            {coupon.discountDescription ?? 'Coupon applied'}
          </RNText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove coupon"
          onPress={() => remove.mutate()}
          disabled={remove.isPending}
          hitSlop={8}
          style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.7 }]}
        >
          <RNText style={styles.removeText}>
            {remove.isPending ? 'Removing…' : 'Remove'}
          </RNText>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.inputRow}>
        <View style={styles.inputIcon}>
          <Ionicons name="ticket-outline" size={15} color={colors.primary} />
        </View>

        <TextInput
          style={styles.input}
          accessibilityLabel="Coupon code"
          placeholder="Enter coupon code"
          placeholderTextColor={colors.textMuted}
          value={code}
          onChangeText={(value) => {
            setCode(value);
            setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!apply.isPending}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply coupon"
          onPress={() => {
            if (code.trim().length === 0) {
              setError('Enter a coupon code first.');
              return;
            }
            apply.mutate();
          }}
          disabled={apply.isPending || code.trim().length === 0}
          style={({ pressed }) => [
            styles.applyBtn,
            (apply.isPending || code.trim().length === 0 || pressed) && { opacity: 0.5 },
          ]}
        >
          <RNText style={styles.applyText}>{apply.isPending ? '…' : 'APPLY'}</RNText>
        </Pressable>
      </View>

      {error !== null ? <RNText style={styles.error}>{error}</RNText> : null}
    </View>
  );
}

/** Map API failures to customer-actionable copy. */
function friendlyMessage(err: Error): string {
  const message = err.message ?? '';
  if (/404|not found|does not exist/i.test(message)) return 'That code is not valid.';
  if (/expired|inactive|window/i.test(message)) return 'This coupon has expired.';
  if (/minimum|min order/i.test(message)) return 'Your order does not meet this coupon\'s minimum.';
  if (/limit|already|redemption/i.test(message)) return 'You have already used this coupon.';
  if (/network|fetch/i.test(message)) return 'No connection — try again when you are online.';
  return message.length > 0 && message.length < 120 ? message : 'This coupon could not be applied.';
}

const styles = StyleSheet.create({
  /* Entry state — a filled field row, no card chrome (the COUPONS card
     wrapping this box already provides surface + border + shadow). */
  inputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  inputIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 89, 76, 0.08)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    color: colors.text,
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  applyBtn: {
    alignItems: 'center',
    backgroundColor: '#094a3c',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  applyText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  error: {
    color: colors.danger,
    fontSize: 11.5,
    marginTop: 8,
  },

  /* Applied state — success-tinted surface, stacked code + description,
     quiet Remove action. */
  appliedCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(31, 122, 67, 0.08)',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  appliedIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  appliedText: {
    flex: 1,
    minWidth: 0,
  },
  appliedCode: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  appliedDesc: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  removeBtn: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
});
