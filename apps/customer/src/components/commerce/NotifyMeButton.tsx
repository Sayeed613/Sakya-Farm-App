import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { journeyApi } from '../../api/journey';
import { useAuthStore } from '../../stores/auth-store';
import { ClickableDiv, IS_WEB } from './ClickableDiv';

/**
 * Notify Me — the sold-out card control.
 *
 * A tap subscribes the signed-in customer to a back-in-stock alert for the
 * product's default variant (`POST /stock-alerts`, server-deduplicated by the
 * (user, variant) unique constraint). Guests are routed to the phone flow by
 * the caller via `onRequireAuth`.
 *
 * States: idle → subscribed (persistent check state, owned by the ['stockAlert',
 * variantId] cache so every card for the same product stays in sync) → error.
 */
export function NotifyMeButton({
  productId,
  variantId,
  height = 32,
  onRequireAuth,
}: {
  productId: string;
  /** The variant the alert watches — resolved from the product detail cache. */
  variantId: string | null;
  height?: number;
  onRequireAuth?: () => void;
}) {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.session !== null);
  const [localError, setLocalError] = useState<string | null>(null);

  const alertKey = ['stockAlert', productId] as const;
  const subscribed = queryClient.getQueryData<boolean>(alertKey) === true;

  const subscribe = useMutation({
    mutationFn: async () => {
      if (variantId === null) throw new Error('Variant unavailable');
      return journeyApi.subscribeStockAlert(variantId);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(alertKey, result.active);
      setLocalError(null);
    },
  });

  if (subscribed) {
    return (
      <View
        className="items-center justify-center rounded-lg border border-line bg-surface-muted px-3"
        style={{ height }}
        accessibilityLabel="We will notify you when this is back"
      >
        <RNText className="text-[10.5px] font-bold" style={{ color: '#2E7D4F' }}>
          ✓ We&apos;ll notify you
        </RNText>
      </View>
    );
  }

  const disabled = subscribe.isPending || variantId === null;

  const handlePress = () => {
    if (disabled) return;
    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }
    subscribe.mutate();
  };

  // Web note: this control lives inside the product card's outer <button> —
  // a Pressable with role="button" here would nest <button> in <button>
  // (invalid HTML, React hydration error). ClickableDiv also stops
  // propagation so the card's quick view doesn't fire alongside it.

  return (
    <View>
      {IS_WEB ? (
        <ClickableDiv
          accessibilityLabel="Notify me when back in stock"
          onClick={handlePress}
          className="items-center justify-center rounded-lg border border-line bg-surface-muted px-3 cursor-pointer"
          style={{
            height,
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <RNText className="text-[10.5px] font-bold" style={{ color: '#7C7A72' }}>
            {subscribe.isPending ? '…' : 'Notify Me'}
          </RNText>
        </ClickableDiv>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notify me when back in stock"
          onPress={handlePress}
          disabled={disabled}
          style={({ pressed }) => [
            {
              height,
              opacity: pressed || subscribe.isPending ? 0.6 : 1,
            },
          ]}
          className="items-center justify-center rounded-lg border border-line bg-surface-muted px-3"
        >
          <RNText className="text-[10.5px] font-bold" style={{ color: '#7C7A72' }}>
            {subscribe.isPending ? '…' : 'Notify Me'}
          </RNText>
        </Pressable>
      )}
      {(localError ?? subscribe.error) != null ? (
        <RNText className="mt-0.5 text-[10px]" style={{ color: '#B42318' }} numberOfLines={1}>
          {localError ?? 'Could not subscribe — try again'}
        </RNText>
      ) : null}
    </View>
  );
}
