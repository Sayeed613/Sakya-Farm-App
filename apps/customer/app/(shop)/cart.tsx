import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { cartApi } from '../../src/api/cart';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { LoadingState } from '../../src/components/LoadingState';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { colors, spacing } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth-store';
import { guestCartCount, useGuestCartStore, type GuestCartLine } from '../../src/stores/guest-cart-store';

/**
 * Cart — works for guests AND signed-in customers.
 *
 * Guests see their local guest cart (variant ids + quantities only, no client
 * totals) with a checkout CTA that opens the phone flow; the merge happens at
 * authentication and returns the customer here. Signed-in customers see the
 * server cart: every total on screen is the server's.
 *
 * Line display: guests read the catalog snapshot captured at add time;
 * signed-in customers read the server's product/variant titles and image.
 * Internal ids are NEVER rendered — a variant UUID is not a product name.
 */
export default function CartScreen() {
  const session = useAuthStore((state) => state.session);
  const restoring = useAuthStore((state) => state.restoring);

  if (restoring) {
    return <LoadingState />;
  }

  return session === null ? <GuestCartView /> : <ServerCartView />;
}

/* ---------------------------------------------------------------------------
   Shared line presentation
--------------------------------------------------------------------------- */

function LineThumbnail({ imageUrl }: { imageUrl: string | null }) {
  if (imageUrl === null) {
    return (
      <View style={[styles.thumb, styles.thumbPlaceholder]}>
        <RNText style={{ color: colors.textMuted, fontSize: 18 }}>🌿</RNText>
      </View>
    );
  }
  return (
    <View style={styles.thumb}>
      <Image
        source={{ uri: imageUrl }}
        contentFit="cover"
        transition={150}
        recyclingKey={imageUrl}
        style={StyleSheet.absoluteFill}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

function QuantityStepper({
  quantity,
  onDecrement,
  onIncrement,
  busy,
}: {
  quantity: number;
  onDecrement: () => void;
  onIncrement: () => void;
  busy?: boolean;
}) {
  const disabled = busy === true;
  return (
    <View style={[styles.stepper, disabled && { opacity: 0.5 }]} pointerEvents={disabled ? 'none' : 'auto'}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        onPress={onDecrement}
        style={styles.stepButton}
        hitSlop={6}
      >
        <RNText style={styles.stepLabel}>−</RNText>
      </Pressable>
      <RNText style={styles.stepValue}>{quantity}</RNText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        onPress={onIncrement}
        style={styles.stepButton}
        hitSlop={6}
      >
        <RNText style={styles.stepLabel}>+</RNText>
      </Pressable>
    </View>
  );
}

/* ---------------------------------------------------------------------------
   GUEST: local lines only. Prices are NOT shown as authoritative totals —
   the server computes the real ones at merge/checkout time.
--------------------------------------------------------------------------- */

function GuestCartView() {
  const lines = useGuestCartStore((state) => state.lines);
  const priceTotals = useGuestCartStore((state) => state.priceTotals);
  const setQuantity = useGuestCartStore((state) => state.setQuantity);
  const removeLine = useGuestCartStore((state) => state.removeLine);
  const clear = useGuestCartStore((state) => state.clear);

  function handleCheckout() {
    // Authentication merges the guest cart server-side, then the pending
    // redirect brings the customer back here to confirm on real totals.
    useAuthStore.getState().setPendingRedirect('/(shop)/cart');
    router.push('/(auth)/phone');
  }

  if (lines.length === 0) {
    return (
      <Screen>
        <Text variant="title">Your cart</Text>
        <View style={styles.empty}>
          <EmptyState
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            image={require('../../src/assets/empty-cart.png')}
            title="Your cart is empty"
            message="Add something fresh and it will show up here."
            ctaLabel="Start shopping"
            onCta={() => router.replace('/(shop)')}
          />
        </View>
      </Screen>
    );
  }

  const itemCount = guestCartCount(lines);

  return (
    <Screen>
      <Text variant="title">Your cart</Text>
      <FlatList
        contentContainerStyle={styles.list}
        data={lines}
        keyExtractor={(line) => line.variantId}
        renderItem={({ item }) => (
          <GuestLine
            line={item}
            displayPrice={priceTotals[item.variantId]}
            onDecrement={() => {
              const current = lines.find((line) => line.variantId === item.variantId)?.quantity ?? 0;
              setQuantity(item.variantId, current - 1);
            }}
            onIncrement={() => {
              const current = lines.find((line) => line.variantId === item.variantId)?.quantity ?? 0;
              setQuantity(item.variantId, current + 1);
            }}
            onRemove={() => removeLine(item.variantId)}
          />
        )}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Checkout: verify your phone number"
        style={styles.checkout}
        onPress={handleCheckout}
      >
        <RNText style={styles.checkoutLabel}>
          Checkout · {itemCount} item{itemCount === 1 ? '' : 's'}
        </RNText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear cart"
        onPress={clear}
        style={styles.clear}
      >
        <Text color={colors.danger}>Clear cart</Text>
      </Pressable>
    </Screen>
  );
}

function GuestLine({
  line,
  displayPrice,
  onDecrement,
  onIncrement,
  onRemove,
}: {
  line: GuestCartLine;
  displayPrice: number | undefined;
  onDecrement: () => void;
  onIncrement: () => void;
  onRemove: () => void;
}) {
  const title = line.display?.productTitle ?? 'Farm product';
  const variantTitle = line.display?.variantTitle ?? '';
  return (
    <View style={styles.item}>
      <LineThumbnail imageUrl={line.display?.imageUrl ?? null} />
      <View style={styles.itemInfo}>
        <Text variant="heading" numberOfLines={2}>
          {title}
        </Text>
        {variantTitle !== '' ? <Text color={colors.textMuted}>{variantTitle}</Text> : null}
        {displayPrice !== undefined ? (
          <Text color={colors.textMuted}>{`₹${(displayPrice / 100).toFixed(2)} approx.`}</Text>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Remove item" onPress={onRemove} hitSlop={6}>
          <Text color={colors.danger}>Remove</Text>
        </Pressable>
      </View>
      <QuantityStepper quantity={line.quantity} onDecrement={onDecrement} onIncrement={onIncrement} />
    </View>
  );
}

/* ---------------------------------------------------------------------------
   AUTHENTICATED: the server cart, rendered verbatim.
--------------------------------------------------------------------------- */

function ServerCartView() {
  const queryClient = useQueryClient();
  const cart = useQuery({ queryKey: ['cart'], queryFn: cartApi.getCart });
  const update = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) => cartApi.updateItem(id, { quantity }),
    onSuccess: (data) => queryClient.setQueryData(['cart'], data),
  });
  const remove = useMutation({
    mutationFn: (id: string) => cartApi.removeItem(id),
    onSuccess: (data) => queryClient.setQueryData(['cart'], data),
  });

  if (cart.isLoading) return <LoadingState />;
  if (cart.isError) {
    return <ErrorState message="Your cart could not be loaded. Check your connection and try again." />;
  }
  const data = cart.data;
  if (!data) return <ErrorState message="Your cart could not be loaded." />;

  return (
    <Screen>
      <Text variant="title">Your cart</Text>
      <FlatList
        contentContainerStyle={styles.list}
        data={data.items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text color={colors.textMuted}>Your cart is empty.</Text>}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <LineThumbnail imageUrl={item.productImageUrl ?? null} />
            <View style={styles.itemInfo}>
              <Text variant="heading" numberOfLines={2}>
                {item.productTitle}
              </Text>
              <Text color={colors.textMuted}>{item.variantTitle}</Text>
              <Text>{money(item.lineTotalInPaise)}</Text>
              {!item.isAvailable ? (
                <Text color={colors.danger}>Currently unavailable — remove to continue</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.productTitle}`}
                onPress={() => remove.mutate(item.id)}
                hitSlop={6}
              >
                <Text color={colors.danger}>Remove</Text>
              </Pressable>
            </View>
            <QuantityStepper
              quantity={item.quantity}
              busy={update.isPending && update.variables?.id === item.id}
              onDecrement={() => {
                // Quantity 1 → minus removes the line, per the server contract.
                update.mutate({ id: item.id, quantity: item.quantity - 1 });
              }}
              onIncrement={() => update.mutate({ id: item.id, quantity: item.quantity + 1 })}
            />
          </View>
        )}
      />
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <Text>Subtotal</Text>
          <Text variant="heading">{money(data.subtotalInPaise)}</Text>
        </View>
        {data.discountInPaise > 0 ? (
          <View style={styles.summaryRow}>
            <Text>Discount</Text>
            <Text variant="heading">−{money(data.discountInPaise)}</Text>
          </View>
        ) : null}
        <View style={styles.summaryRow}>
          <Text>Total</Text>
          <Text variant="title">{money(data.totalInPaise)}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Proceed to checkout"
        disabled={data.items.length === 0}
        style={({ pressed }) => [
          styles.checkout,
          (data.items.length === 0 || pressed) && { opacity: 0.55 },
        ]}
        onPress={() => {
          // Signed in with a server cart: go straight to checkout. The
          // pending-redirect guard only matters when the session has expired
          // mid-flow, which checkout itself also handles.
          router.push('/(shop)/checkout');
        }}
      >
        <RNText style={styles.checkoutLabel}>Checkout</RNText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue shopping"
        onPress={() => router.replace('/(shop)')}
        style={styles.clear}
      >
        <Text color={colors.primary}>Continue shopping</Text>
      </Pressable>
    </Screen>
  );
}

function money(value: number): string {
  return `₹${(value / 100).toFixed(2)}`;
}

const styles = StyleSheet.create({
  list: { gap: spacing.md, paddingVertical: spacing.lg },
  item: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.canvas,
  },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemInfo: { flex: 1, gap: 2 },
  stepper: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
  },
  stepButton: { paddingHorizontal: 12, paddingVertical: 6 },
  stepLabel: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  stepValue: { color: colors.text, fontSize: 14, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  controls: { alignItems: 'center', flexDirection: 'row', gap: spacing.lg },
  summary: { display: 'flex', gap: spacing.sm, paddingVertical: spacing.lg },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyCta: { padding: spacing.sm },
  checkout: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    minHeight: 50,
    justifyContent: 'center',
  },
  checkoutLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  clear: { alignItems: 'center', padding: spacing.md },
});
