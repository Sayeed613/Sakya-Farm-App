import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addressesApi } from '../../src/api/notifications-api';
import type { CheckoutAddress } from '../../src/api/checkout';
import { AddressSheet } from '../../src/components/checkout/AddressSheet';
import { AuthGate } from '../../src/components/AuthGate';
import { ErrorState } from '../../src/components/ErrorState';
import { SkeletonBlock } from '../../src/components/LoadingSkeleton';
import { SubScreenHeader } from '../../src/components/navigation/SubScreenHeader';
import { useAuthStore } from '../../src/stores/auth-store';
import type { AddressView } from '@sakya/types';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const DANGER = '#B42318';

/**
 * Address book — the real saved-address store (`/users/me/addresses`).
 *
 * Before this screen existed the Account menu's "Address book" row pointed at
 * the Account screen itself, so it did nothing. Every row here is a server
 * record; add/edit/delete all go through the same endpoints the checkout
 * picker uses, so the two surfaces can never disagree.
 */
export default function AddressBookScreen() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((state) => state.session);
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AddressView | null>(null);

  const book = useQuery({
    queryKey: ['addresses'],
    queryFn: addressesApi.list,
    enabled: session !== null,
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: async (input: { id: string | null; address: CheckoutAddress }) => {
      const payload = {
        recipientName: input.address.fullName,
        phone: input.address.phone,
        line1: input.address.line1,
        line2: input.address.line2 === '' ? null : (input.address.line2 ?? null),
        landmark: input.address.landmark === '' ? null : (input.address.landmark ?? null),
        city: input.address.city,
        state: input.address.state,
        pincode: input.address.postalCode,
      };
      if (input.id === null) return addressesApi.create(payload);
      return addressesApi.update(input.id, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setSheetOpen(false);
      setEditing(null);
    },
    onError: (error: Error) => {
      Alert.alert('Could not save the address', error.message || 'Please try again.');
    },
  });

  const remove = useMutation({
    mutationFn: (addressId: string) => addressesApi.remove(addressId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
    onError: () => Alert.alert('Could not remove the address', 'Please try again.'),
  });

  if (session === null) {
    return (
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
        <AuthGate
          icon="location-outline"
          title="Verify your number to see your addresses"
          message="Your saved addresses are personal. Verify your phone to continue."
          redirectTo="/(shop)/address-book"
        />
      </View>
    );
  }

  const addresses = book.data?.addresses ?? [];

  const prefill: CheckoutAddress | null =
    editing === null
      ? null
      : {
          fullName: editing.recipientName,
          phone: editing.phone,
          line1: editing.line1,
          line2: editing.line2 ?? '',
          landmark: editing.landmark ?? '',
          city: editing.city,
          state: editing.state,
          postalCode: editing.pincode,
        };

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <SubScreenHeader title="Address book" />

      {book.isPending ? (
        <View className="gap-3 px-4 pt-3">
          {[0, 1, 2].map((index) => (
            <SkeletonBlock key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </View>
      ) : book.isError ? (
        <ErrorState
          title="Could not load your addresses"
          message="We could not reach your address book just now. Check your connection and try again."
          onRetry={() => void book.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} className="gap-3">
          {addresses.length === 0 ? (
            <View className="items-center gap-2 px-6 pt-16">
              <Ionicons name="location-outline" size={40} color={MUTED} />
              <RNText className="text-[15px] font-bold" style={{ color: INK }}>
                No saved addresses
              </RNText>
              <RNText className="text-center text-[13px] leading-5" style={{ color: MUTED }}>
                Add one here, or save it while checking out.
              </RNText>
            </View>
          ) : (
            addresses.map((address) => (
              <View
                key={address.id}
                className="rounded-2xl border bg-white p-4"
                style={{ borderColor: LINE }}
              >
                <View className="flex-row items-center gap-2">
                  <RNText className="flex-1 text-[13.5px] font-bold" style={{ color: INK }}>
                    {address.recipientName}
                  </RNText>
                  {address.isDefault ? (
                    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#E3EFE9' }}>
                      <RNText className="text-[10px] font-bold" style={{ color: BRAND }}>
                        DEFAULT
                      </RNText>
                    </View>
                  ) : null}
                </View>

                <RNText className="mt-1 text-[12.5px] leading-5" style={{ color: MUTED }}>
                  {[
                    address.line1,
                    address.line2,
                    address.landmark,
                    `${address.city}, ${address.state} ${address.pincode}`,
                  ]
                    .filter((part): part is string => typeof part === 'string' && part.length > 0)
                    .join(', ')}
                </RNText>
                <RNText className="mt-1 text-[12px]" style={{ color: MUTED }}>
                  {address.phone}
                </RNText>

                <View className="mt-3 flex-row items-center gap-4">
                  <Pressable
                    onPress={() => {
                      setEditing(address);
                      setSheetOpen(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit address for ${address.recipientName}`}
                    hitSlop={6}
                  >
                    <RNText className="text-[12.5px] font-bold" style={{ color: BRAND }}>
                      Edit
                    </RNText>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      Alert.alert('Remove this address?', undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => remove.mutate(address.id),
                        },
                      ])
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Remove address for ${address.recipientName}`}
                    hitSlop={6}
                  >
                    <RNText className="text-[12.5px] font-bold" style={{ color: DANGER }}>
                      Remove
                    </RNText>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          <Pressable
            onPress={() => {
              setEditing(null);
              setSheetOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add a new address"
            className="h-12 flex-row items-center justify-center gap-2 rounded-2xl border"
            style={{ borderColor: BRAND }}
          >
            <Ionicons name="add" size={18} color={BRAND} />
            <RNText className="text-[13.5px] font-bold" style={{ color: BRAND }}>
              Add new address
            </RNText>
          </Pressable>
        </ScrollView>
      )}

      <AddressSheet
        visible={sheetOpen}
        initial={prefill}
        contactDefaults={
          session.user.firstName !== ''
            ? {
                name: [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim(),
                phone: session.user.phone ?? '',
              }
            : null
        }
        onSave={(address) => save.mutate({ id: editing?.id ?? null, address })}
        onClose={() => {
          setSheetOpen(false);
          setEditing(null);
        }}
      />
    </View>
  );
}
