import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import type { ReturnReason } from '@sakya/validation';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/** Human copy for the server's closed reason set. */
const REASON_LABELS: Record<ReturnReason, string> = {
  DAMAGED: 'Arrived damaged',
  WRONG_ITEM: 'Wrong item delivered',
  QUALITY: 'Quality not up to the mark',
  NOT_AS_DESCRIBED: 'Not as described',
  EXPIRED_OR_SPOILED: 'Expired or spoiled',
  CHANGED_MIND: 'Changed my mind',
};

const REASONS = Object.keys(REASON_LABELS) as ReturnReason[];

/** One line the customer can pick to return. */
export interface ReturnableItem {
  orderItemId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
}

/**
 * Return request sheet — pick an item, pick a reason, add an optional note.
 *
 * Eligibility is decided by the server (`GET /returns/eligibility/:item`);
 * this sheet only collects the input and renders server errors verbatim.
 */
export function ReturnSheet({
  visible,
  orderNumber,
  items,
  submitting,
  errorMessage,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  orderNumber: string;
  items: ReturnableItem[];
  submitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (input: { orderItemId: string; reason: ReturnReason; comment?: string }) => void;
}) {
  const insets = useSafeAreaInsets();
  const [orderItemId, setOrderItemId] = useState<string | null>(items[0]?.orderItemId ?? null);
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [comment, setComment] = useState('');

  // Re-open → fresh draft (same contract as the cancel sheet).
  useEffect(() => {
    if (!visible) {
      setOrderItemId(items[0]?.orderItemId ?? null);
      setReason(null);
      setComment('');
    }
  }, [visible, items]);

  const canSubmit = orderItemId !== null && reason !== null && !submitting;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="height" className="flex-1">
        <Pressable
          accessibilityLabel="Close return dialog"
          className="flex-1 bg-black/40"
          onPress={onClose}
          disabled={submitting}
        />
        <Animated.View
          entering={SlideInDown.springify().damping(22)}
          exiting={SlideOutDown}
          className="rounded-t-3xl bg-white"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {/* Grabber + title */}
          <View className="items-center pt-2.5">
            <View className="h-1 w-10 rounded-full" style={{ backgroundColor: LINE }} />
          </View>
          <View className="flex-row items-center gap-2 px-5 pt-3">
            <Ionicons name="return-up-back" size={18} color={BRAND} />
            <RNText className="flex-1 text-[16px] font-bold" style={{ color: INK }}>
              Request a return
            </RNText>
            <RNText className="text-[12px]" style={{ color: MUTED }}>
              {orderNumber}
            </RNText>
          </View>

          <ScrollView className="px-5 pt-3" style={{ maxHeight: 380 }}>
            {items.length === 0 ? (
              <RNText className="text-[13px]" style={{ color: MUTED }}>
                No items on this order are eligible for a return.
              </RNText>
            ) : (
              <>
                {/* Item picker */}
                <RNText className="mb-2 text-[12px] font-bold" style={{ color: MUTED }}>
                  ITEM
                </RNText>
                <View className="gap-2">
                  {items.map((item) => {
                    const selected = item.orderItemId === orderItemId;
                    return (
                      <Pressable
                        key={item.orderItemId}
                        onPress={() => setOrderItemId(item.orderItemId)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        className="flex-row items-center gap-3 rounded-xl border px-3.5 py-3"
                        style={{ borderColor: selected ? BRAND : LINE }}
                      >
                        <Ionicons
                          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={18}
                          color={selected ? BRAND : MUTED}
                        />
                        <View className="flex-1">
                          <RNText className="text-[13px] font-semibold" style={{ color: INK }} numberOfLines={1}>
                            {item.productTitle}
                          </RNText>
                          <RNText className="text-[11.5px]" style={{ color: MUTED }}>
                            {item.variantTitle} · Qty {item.quantity}
                          </RNText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Reason picker */}
                <RNText className="mb-2 mt-4 text-[12px] font-bold" style={{ color: MUTED }}>
                  REASON
                </RNText>
                <View className="flex-row flex-wrap gap-2">
                  {REASONS.map((candidate) => {
                    const selected = candidate === reason;
                    return (
                      <Pressable
                        key={candidate}
                        onPress={() => setReason(candidate)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        className="rounded-full border px-3 py-1.5"
                        style={{ borderColor: selected ? BRAND : LINE, backgroundColor: selected ? '#EDF4F0' : '#FFFFFF' }}
                      >
                        <RNText
                          className="text-[12px] font-semibold"
                          style={{ color: selected ? BRAND : INK }}
                        >
                          {REASON_LABELS[candidate]}
                        </RNText>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Optional note */}
                <RNText className="mb-2 mt-4 text-[12px] font-bold" style={{ color: MUTED }}>
                  NOTE (OPTIONAL)
                </RNText>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  maxLength={500}
                  placeholder="Anything we should know?"
                  placeholderTextColor={MUTED}
                  className="rounded-xl border px-3.5 py-2.5 text-[13px]"
                  style={{ borderColor: LINE, color: INK, minHeight: 72, textAlignVertical: 'top' }}
                />
              </>
            )}
          </ScrollView>

          {errorMessage !== null ? (
            <RNText className="px-5 pt-2 text-[12.5px] font-semibold" style={{ color: '#B3453E' }}>
              {errorMessage}
            </RNText>
          ) : null}

          {/* Actions */}
          <View className="flex-row gap-3 px-5 pt-4">
            <Pressable
              onPress={onClose}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Cancel return request"
              className="h-12 flex-1 items-center justify-center rounded-full border"
              style={{ borderColor: LINE }}
            >
              <RNText className="text-[13.5px] font-bold" style={{ color: INK }}>
                Close
              </RNText>
            </Pressable>
            <Pressable
              onPress={() => {
                if (orderItemId === null || reason === null) return;
                onSubmit({ orderItemId, reason, comment: comment.trim() || undefined });
              }}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Submit return request"
              className="h-12 flex-1 items-center justify-center rounded-full"
              style={{ backgroundColor: BRAND, opacity: canSubmit ? 1 : 0.5 }}
            >
              <RNText className="text-[13.5px] font-bold text-white">
                {submitting ? 'Submitting…' : 'Submit request'}
              </RNText>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
