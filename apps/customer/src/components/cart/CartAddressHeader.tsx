import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { useAuthStore } from '../../stores/auth-store';
import { useLastAddressStore } from '../../stores/last-address-store';
import { addressesApi } from '../../api/notifications-api';
import { AddressPickerSheet } from '../checkout/AddressPickerSheet';
import { AddressSheet } from '../checkout/AddressSheet';
import type { CheckoutAddress } from '../../api/checkout';
import { cardShadow, softShadow } from '../../lib/shadows';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/**
 * The cart's delivery-address card — the explicit "Change address" entry
 * BEFORE checkout (Blinkit/Zepto pattern: the destination is confirmed on the
 * cart, not discovered at checkout).
 *
 * Signed-in customers get their saved/default address (server address book)
 * with the picker sheet; guests get their last-used checkout address, or the
 * add-address card when none exists. Choosing an address stores it through
 * the same store checkout reads, so cart and checkout always agree — whatever
 * is set here prefills checkout automatically.
 */
export function CartAddressHeader() {
  const session = useAuthStore((state) => state.session);
  const lastAddress = useLastAddressStore((state) => state.address);
  const rememberAddress = useLastAddressStore((state) => state.remember);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CheckoutAddress | null>(null);

  const book = useQuery({
    queryKey: ['addresses'],
    queryFn: addressesApi.list,
    enabled: session !== null,
    staleTime: 30_000,
  });

  const addresses = book.data?.addresses ?? [];

  const defaultAddress = useMemo(() => {
    return addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
  }, [addresses]);

  /** The address currently delivering-to, in checkout's own shape. */
  const selected = useMemo<CheckoutAddress | null>(() => {
    if (session !== null && defaultAddress) {
      return {
        fullName: defaultAddress.recipientName,
        phone: defaultAddress.phone,
        line1: defaultAddress.line1,
        line2: defaultAddress.line2 ?? '',
        landmark: defaultAddress.landmark ?? '',
        city: defaultAddress.city,
        state: defaultAddress.state,
        postalCode: defaultAddress.pincode,
      };
    }
    return lastAddress;
  }, [session, defaultAddress, lastAddress]);

  const contactDefaults = useMemo(
    () =>
      session
        ? {
            name: [session.user.firstName, session.user.lastName].filter(Boolean).join(' '),
            phone: session.user.phone ?? '',
          }
        : null,
    [session],
  );

  /** Single-line rendering, same composition as the checkout card. */
  const addressLine = (address: CheckoutAddress): string =>
    [
      address.line1,
      address.landmark ?? '',
      `${address.city}, ${address.state} ${address.postalCode}`,
    ]
      .filter((part) => part.trim() !== '')
      .join(', ');

  const openChange = () => (session !== null ? setPickerOpen(true) : setEditorOpen(true));

  const showAdd = selected === null && (session === null || !book.isPending);
  const showLoading = selected === null && session !== null && book.isPending;

  return (
    <View style={styles.wrap}>
      {selected !== null ? (
        // CHANGE — solid card, mirrors the checkout address card.
        <Pressable
          onPress={openChange}
          accessibilityRole="button"
          accessibilityLabel={`Deliver to ${selected.fullName}. Change delivery address`}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="location" size={18} color={BRAND} />
          </View>
          <View style={styles.textBlock}>
            <RNText style={styles.overline}>DELIVERING TO</RNText>
            <RNText style={styles.name} numberOfLines={1}>
              {selected.fullName}
              {selected.phone.trim() !== '' ? ` · ${selected.phone}` : ''}
            </RNText>
            <RNText style={styles.address} numberOfLines={2}>
              {addressLine(selected)}
            </RNText>
          </View>
          <View style={styles.chip}>
            <RNText style={styles.chipText}>Change</RNText>
          </View>
        </Pressable>
      ) : showAdd ? (
        // ADD — dashed card, mirrors the checkout add-address entry.
        <Pressable
          onPress={openChange}
          accessibilityRole="button"
          accessibilityLabel="Add delivery address"
          style={({ pressed }) => [styles.card, styles.cardAdd, pressed && { opacity: 0.92 }]}
        >
          <View style={styles.iconWrapAdd}>
            <Ionicons name="add" size={18} color={BRAND} />
          </View>
          <View style={styles.textBlock}>
            <RNText style={[styles.name, { color: BRAND }]}>Add delivery address</RNText>
            <RNText style={styles.address}>
              Saved addresses and manual entry
            </RNText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={MUTED} />
        </Pressable>
      ) : showLoading ? (
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="location-outline" size={18} color={MUTED} />
          </View>
          <View style={styles.textBlock}>
            <RNText style={styles.overline}>DELIVERING TO</RNText>
            <RNText style={styles.address}>Loading saved addresses…</RNText>
          </View>
        </View>
      ) : null}

      <AddressPickerSheet
        visible={pickerOpen}
        selected={selected}
        onClose={() => setPickerOpen(false)}
        onConfirm={(address) => {
          rememberAddress(address);
          setPickerOpen(false);
        }}
        onEdit={(address) => {
          setEditing(address);
          setPickerOpen(false);
          setEditorOpen(true);
        }}
        onAddNew={() => {
          setEditing(null);
          setPickerOpen(false);
          setEditorOpen(true);
        }}
      />

      <AddressSheet
        visible={editorOpen}
        initial={editing ?? lastAddress}
        contactDefaults={contactDefaults}
        canSaveToBook={session !== null}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={(address) => {
          rememberAddress(address);
          setEditorOpen(false);
          setEditing(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
    marginBottom: 4,
  },
  card: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: LINE,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 18,
    padding: 14,
    ...cardShadow,
  },
  cardAdd: {
    borderStyle: 'dashed',
    ...softShadow,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 89, 76, 0.08)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  iconWrapAdd: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 89, 76, 0.08)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  overline: {
    color: MUTED,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  name: {
    color: INK,
    fontSize: 13.5,
    fontWeight: '700',
    marginTop: 2,
  },
  address: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  chip: {
    backgroundColor: '#F3EDE3',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: {
    color: BRAND,
    fontSize: 11.5,
    fontWeight: '700',
  },
});
