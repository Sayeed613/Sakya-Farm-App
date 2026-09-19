import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';

import { addressesApi } from '../../api/notifications-api';
import type { AddressView } from '@sakya/types';
import type { CheckoutAddress } from '../../api/checkout';
import { Image } from 'expo-image';
import { SkeletonBlock } from '../LoadingSkeleton';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

export interface AddressPickerSheetProps {
  visible: boolean;
  /** Currently chosen address, highlighted in the list. */
  selected: CheckoutAddress | null;
  /** Close without changing anything. */
  onClose: () => void;
  /** The customer confirmed an address (existing or newly added via the form). */
  onConfirm: (address: CheckoutAddress) => void;
  /** Opens the manual-entry sheet prefilling from the chosen address. */
  onEdit: (address: CheckoutAddress) => void;
}

/**
 * Saved-address picker for signed-in customers.
 *
 * Server data only (`GET /users/me/addresses`); the default address sorts
 * first. Select confirms immediately, or edit any entry / add a new one via
 * the entry form sheet. Delete asks before removing — the server enforces
 * ownership, so a stale row simply 404s and the list refreshes.
 */
export function AddressPickerSheet({
  visible,
  selected,
  onClose,
  onConfirm,
  onEdit,
}: AddressPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const book = useQuery({
    queryKey: ['addresses'],
    queryFn: addressesApi.list,
    enabled: visible,
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => addressesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['addresses'] }),
  });

  function sameAs(saved: AddressView, current: CheckoutAddress | null): boolean {
    if (current === null) return false;
    return (
      saved.recipientName === current.fullName &&
      saved.line1 === current.line1 &&
      saved.pincode === current.postalCode
    );
  }

  function confirmSaved(saved: AddressView) {
    onConfirm({
      fullName: saved.recipientName,
      phone: saved.phone,
      line1: saved.line1,
      line2: saved.line2 ?? '',
      landmark: saved.landmark ?? '',
      city: saved.city,
      state: saved.state,
      postalCode: saved.pincode,
    });
  }

  function handleRemove(address: AddressView) {
    Alert.alert('Remove address', `Remove the address for ${address.recipientName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => remove.mutate(address.id),
      },
    ]);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss address picker"
          onPress={onClose}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable onPress={() => undefined}>
            <Animated.View
              entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
              exiting={SlideOutDown.duration(190).easing(Easing.in(Easing.cubic))}
              className="rounded-t-[24px] bg-canvas pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}
            >
              <View className="items-center pb-2">
                <View className="h-1 w-10 rounded-full bg-line" />
              </View>

              <View className="px-4 pb-1">
                <RNText className="text-[17px] font-bold" style={{ color: INK }}>
                  Saved addresses
                </RNText>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                className="mt-2"
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}
              >
                {book.isPending ? (
                  <View className="gap-3 py-2">
                    <SkeletonBlock className="h-20 w-full rounded-2xl" />
                    <SkeletonBlock className="h-20 w-full rounded-2xl" />
                  </View>
                ) : book.isError ? (
                  <View className="items-center gap-2 py-6">
                    <RNText className="text-[13px]" style={{ color: MUTED }}>
                      Could not load your addresses.
                    </RNText>
                    <Pressable onPress={() => void book.refetch()} hitSlop={6}>
                      <RNText className="text-[13px] font-bold" style={{ color: BRAND }}>
                        Try again
                      </RNText>
                    </Pressable>
                  </View>
                ) : (book.data?.addresses.length ?? 0) === 0 ? (
                  <View className="items-center gap-1.5 py-4">
                    <Image
                      // eslint-disable-next-line @typescript-eslint/no-require-imports
                      source={require('../../assets/no address.png')}
                      style={{ width: 120, height: 82 }}
                      contentFit="contain"
                      cachePolicy="disk"
                    />
                    <RNText className="text-[13px]" style={{ color: MUTED }}>
                      No saved addresses yet.
                    </RNText>
                  </View>
                ) : (
                  book.data?.addresses.map((saved) => {
                    const active = sameAs(saved, selected);
                    return (
                      <View
                        key={saved.id}
                        className="rounded-2xl border p-3.5"
                        style={{
                          borderColor: active ? BRAND : LINE,
                          backgroundColor: active ? '#F4FAF8' : '#FFFFFF',
                        }}
                      >
                        <Pressable
                          onPress={() => confirmSaved(saved)}
                          accessibilityRole="button"
                          accessibilityLabel={`Use address for ${saved.recipientName}`}
                        >
                          <View className="flex-row items-center gap-2">
                            <RNText className="flex-1 text-[14px] font-bold" style={{ color: INK }} numberOfLines={1}>
                              {saved.recipientName} · {saved.phone}
                            </RNText>
                            {saved.isDefault ? (
                              <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#E7F0EE' }}>
                                <RNText className="text-[9.5px] font-bold" style={{ color: BRAND }}>
                                  DEFAULT
                                </RNText>
                              </View>
                            ) : null}
                          </View>
                          <RNText className="mt-1 text-[12.5px] leading-5" style={{ color: MUTED }}>
                            {[
                              saved.line1,
                              saved.line2 ?? '',
                              saved.landmark ?? '',
                              `${saved.city}, ${saved.state} ${saved.pincode}`,
                            ]
                              .filter((part) => part.trim() !== '')
                              .join(', ')}
                          </RNText>
                        </Pressable>
                        <View className="mt-2.5 flex-row items-center gap-4 border-t pt-2.5" style={{ borderColor: LINE }}>
                          <Pressable
                            onPress={() => onEdit({
                              fullName: saved.recipientName,
                              phone: saved.phone,
                              line1: saved.line1,
                              line2: saved.line2 ?? '',
                              landmark: saved.landmark ?? '',
                              city: saved.city,
                              state: saved.state,
                              postalCode: saved.pincode,
                            })}
                            accessibilityRole="button"
                            accessibilityLabel="Edit address"
                            hitSlop={6}
                            className="flex-row items-center gap-1"
                          >
                            <Ionicons name="create-outline" size={14} color={BRAND} />
                            <RNText className="text-[12px] font-bold" style={{ color: BRAND }}>
                              Edit
                            </RNText>
                          </Pressable>
                          <Pressable
                            onPress={() => handleRemove(saved)}
                            accessibilityRole="button"
                            accessibilityLabel="Delete address"
                            hitSlop={6}
                            className="flex-row items-center gap-1"
                          >
                            <Ionicons name="trash-outline" size={14} color="#B3453E" />
                            <RNText className="text-[12px] font-bold" style={{ color: '#B3453E' }}>
                              Delete
                            </RNText>
                          </Pressable>
                          <View className="flex-1" />
                          {active ? <Ionicons name="checkmark-circle" size={17} color={BRAND} /> : null}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              <View className="px-4 pt-2">
                <Pressable
                  onPress={onClose}
                  disabled={book.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Add a new address"
                  className="h-[46px] flex-row items-center justify-center gap-2 rounded-full border"
                  style={{ borderColor: BRAND }}
                >
                  <Ionicons name="add" size={18} color={BRAND} />
                  <RNText className="text-[14px] font-bold" style={{ color: BRAND }}>
                    Add new address
                  </RNText>
                </Pressable>
              </View>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
