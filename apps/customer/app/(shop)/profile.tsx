import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addressesApi } from '../../src/api/notifications-api';
import { AuthGate } from '../../src/components/AuthGate';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { colors, spacing } from '../../src/theme';
import { useAuthStore } from '../../src/stores/auth-store';

/**
 * Account — personal surface, gated like checkout and orders.
 *
 * Identity shown is the phone number (the authentication identity); email
 * appears only when the customer added one. "Sign out" clears the session and
 * returns to the shop: there is no login screen to go back to, the next auth
 * need will open the phone flow again.
 */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const restoring = useAuthStore((state) => state.restoring);
  const logout = useAuthStore((state) => state.logout);

  if (restoring) {
    return (
      <Screen>
        <Text color={colors.textMuted}>Loading…</Text>
      </Screen>
    );
  }

  if (session === null) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <AuthGate
          icon="person-outline"
          title="Verify your number to manage your account"
          message="Your profile, addresses and app settings live here."
          redirectTo="/(shop)/profile"
        />
      </View>
    );
  }

  const { user } = session;
  const displayName = user.firstName === 'Customer' ? 'Welcome' : user.firstName;

  async function handleLogout() {
    await logout();
    router.replace('/(shop)');
  }

  return (
    <Screen scroll>
      <Text variant="title">Account</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <Ionicons name="call-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.rowText}>
            <Text variant="label" color={colors.textMuted}>
              Phone
            </Text>
            <Text variant="heading">{user.phone ?? '—'}</Text>
          </View>
        </View>

        {user.email !== null ? (
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Ionicons name="mail-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.rowText}>
              <Text variant="label" color={colors.textMuted}>
                Email
              </Text>
              <Text variant="heading">{user.email}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <Ionicons name="person-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.rowText}>
            <Text variant="label" color={colors.textMuted}>
              Name
            </Text>
            <Text variant="heading">
              {user.firstName}
              {user.lastName !== null && user.lastName.length > 0 ? ` ${user.lastName}` : ''}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.hello} color={colors.textMuted}>
        {displayName}
        {user.firstName === 'Customer' ? ' — add your name from profile completion next time you sign in.' : ''}
      </Text>

      {/* Saved addresses — the server-side book used by checkout. */}
      <SavedAddresses />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]}
        onPress={() => void handleLogout()}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text color={colors.danger} style={styles.signOutLabel}>
          Sign out
        </Text>
      </Pressable>
    </Screen>
  );
}

/**
 * Saved addresses card — read-only here (management lives in the checkout
 * picker). Rendered from the server book; empty copy points to checkout.
 */
function SavedAddresses() {
  const book = useQuery({
    queryKey: ['addresses'],
    queryFn: addressesApi.list,
    staleTime: 30_000,
  });

  const addresses = book.data?.addresses ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="bookmark-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.rowText}>
          <Text variant="label" color={colors.textMuted}>
            Saved addresses
          </Text>
          <Text variant="heading">
            {book.isPending ? 'Loading…' : `${addresses.length} saved`}
          </Text>
        </View>
      </View>

      {addresses.slice(0, 3).map((address) => (
        <View key={address.id} style={styles.addressRow}>
          <RNText style={styles.addressText} numberOfLines={2}>
            {address.line1}, {address.city} {address.pincode}
            {address.isDefault ? '  ·  default' : ''}
          </RNText>
        </View>
      ))}

      {addresses.length === 0 && !book.isPending ? (
        <Text color={colors.textMuted} style={styles.addressText}>
          Add one from checkout — tick \u201cSave to my address book\u201d.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: `${colors.primary}14`,
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  hello: { marginTop: spacing.md, fontSize: 12.5 },
  addressRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  addressText: { fontSize: 12.5, lineHeight: 18 },
  signOut: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
  },
  signOutLabel: { fontWeight: '600' },
});
