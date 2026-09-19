import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';
const DANGER = '#B3453E';

const MAX_REASON = 500;

/**
 * Cancel confirmation + reason prompt.
 *
 * The backend requires a non-empty reason (max 500 chars) and re-validates
 * the status transition, so this sheet only enforces the same minimum locally
 * and renders server errors verbatim.
 */
export function CancelReasonSheet({
  visible,
  orderNumber,
  submitting,
  errorMessage,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  orderNumber: string;
  submitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState('');

  // Reset the draft whenever the sheet is dismissed so a reopened sheet
  // starts clean and no stale reason silently submits later.
  useEffect(() => {
    if (!visible) setReason('');
  }, [visible]);

  const canSubmit = reason.trim().length > 0 && !submitting;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="height" className="flex-1">
        {/* Backdrop — tap to dismiss when not submitting */}
        <Pressable
          accessibilityLabel="Close cancel dialog"
          onPress={submitting ? undefined : onClose}
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(23,26,24,0.45)' }}
        />
        <Animated.View
          entering={SlideInDown.springify().damping(20)}
          exiting={SlideOutDown}
          className="mt-auto rounded-t-3xl"
          style={{ backgroundColor: '#FFFFFF', paddingBottom: insets.bottom + 16 }}
        >
          <View className="items-center pt-2.5">
            <View className="h-1 w-10 rounded-full" style={{ backgroundColor: LINE }} />
          </View>

          <View className="gap-1 px-5 pb-1 pt-3">
            <View className="flex-row items-center gap-2.5">
              <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: '#FDF4F2' }}>
                <Ionicons name="close-circle-outline" size={20} color={DANGER} />
              </View>
              <RNText className="flex-1 text-[16px] font-bold" style={{ color: INK }}>
                Cancel this order?
              </RNText>
            </View>
            <RNText className="text-[12.5px] leading-4" style={{ color: MUTED }}>
              {orderNumber} will be cancelled and any reserved items released. This cannot be undone.
            </RNText>
          </View>

          <View className="px-5 pt-3">
            <RNText className="mb-1.5 text-[12px] font-semibold" style={{ color: INK }}>
              Reason for cancellation
            </RNText>
            <TextInput
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
              maxLength={MAX_REASON}
              editable={!submitting}
              placeholder="e.g. Ordered the wrong item"
              placeholderTextColor={MUTED}
              className="rounded-xl border px-3.5 py-2.5 text-[13.5px]"
              style={{ borderColor: LINE, color: INK, minHeight: 76, textAlignVertical: 'top' }}
            />
            <View className="flex-row items-center justify-between pt-1">
              <RNText className="text-[11.5px]" style={{ color: errorMessage ? DANGER : MUTED }}>
                {errorMessage ?? 'Required — shared with the store team'}
              </RNText>
              <RNText className="text-[11px]" style={{ color: MUTED }}>
                {reason.length}/{MAX_REASON}
              </RNText>
            </View>
          </View>

          <View className="flex-row gap-3 px-5 pt-4">
            <Pressable
              onPress={onClose}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Keep order"
              className="h-11 flex-1 items-center justify-center rounded-full border"
              style={{ borderColor: LINE, opacity: submitting ? 0.6 : 1 }}
            >
              <RNText className="text-[13.5px] font-bold" style={{ color: INK }}>
                Keep order
              </RNText>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(reason.trim())}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Cancel order"
              accessibilityState={{ disabled: !canSubmit, busy: submitting }}
              className="h-11 flex-1 items-center justify-center rounded-full"
              style={{
                backgroundColor: canSubmit ? DANGER : '#E8C9C4',
              }}
            >
              {submitting ? (
                <View className="flex-row items-center gap-2">
                  <Ionicons name="hourglass-outline" size={14} color="#FFFFFF" />
                  <RNText className="text-[13.5px] font-bold" style={{ color: '#FFFFFF' }}>
                    Cancelling…
                  </RNText>
                </View>
              ) : (
                <RNText className="text-[13.5px] font-bold" style={{ color: '#FFFFFF' }}>
                  Cancel order
                </RNText>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Re-exported so screens share one source for the destructive accent. */
export { BRAND, INK, MUTED, LINE, DANGER };
