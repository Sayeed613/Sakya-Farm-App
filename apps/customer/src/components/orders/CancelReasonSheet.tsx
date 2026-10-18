import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';

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
 *
 * Layout follows the app's canonical bottom-sheet architecture (see
 * VariantPickerSheet / AddressSheet): the backdrop is an absolute-fill
 * SIBLING of the sheet, and the sheet is anchored by an
 * `absolute inset-0 justify-end` container. The previous structure — a
 * flex-1 KeyboardAvoidingView with the sheet on `mt-auto` — bottom-anchored
 * only on native; on web the sheet stuck to the TOP of the modal with the
 * page showing underneath it.
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
  const [reasonFocused, setReasonFocused] = useState(false);

  // Reset the draft whenever the sheet is dismissed so a reopened sheet
  // starts clean and no stale reason silently submits later.
  useEffect(() => {
    if (!visible) setReason('');
  }, [visible]);

  const canSubmit = reason.trim().length > 0 && !submitting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop fades; the sheet slides. One animation per element. */}
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
        {/* Backdrop — tap to dismiss when not submitting. Kept a SIBLING of
            the sheet (never its ancestor): wrapped around the form it would
            render a <button> around every field on web, and the browser turns
            keys typed in the field into a backdrop click. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close cancel dialog"
          onPress={submitting ? undefined : onClose}
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(23,26,24,0.45)' }}
        />
        <View className="absolute inset-0 justify-end" style={{ pointerEvents: 'box-none' }}>
          {/* No-op press target: taps inside the sheet must not fall through
              to the backdrop behind it. */}
          <Pressable onPress={() => undefined}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <Animated.View
                entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
                exiting={SlideOutDown.duration(190).easing(Easing.in(Easing.cubic))}
                // Sheet chrome is INLINE on purpose: Animated.View has no
                // cssInterop in this app, so className (rounded-t-3xl px-4 pt-3)
                // never reached the DOM — square corners and content sitting
                // flush against the screen edge.
                style={{
                  backgroundColor: '#FFFFFF',
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 24,
                  paddingHorizontal: 16,
                  paddingTop: 12,
                  paddingBottom: insets.bottom + 16,
                }}
              >
                <View className="items-center pt-2.5">
                  <View className="h-1 w-10 rounded-full" style={{ backgroundColor: LINE }} />
                </View>

                <View className="gap-1 px-1 pb-1 pt-3">
                  <View className="flex-row items-center gap-2.5">
                    <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: '#FDF4F2' }}>
                      <Ionicons name="close-circle-outline" size={20} color={DANGER} />
                    </View>
                    <RNText className="flex-1 text-[16px] font-bold" style={{ color: INK }}>
                      Cancel this order?
                    </RNText>
                    {/* Same close affordance the other sheets carry (variant
                        picker, address form). Plain Pressable — className is
                        safe on non-animated components. */}
                    <Pressable
                      onPress={onClose}
                      disabled={submitting}
                      accessibilityRole="button"
                      accessibilityLabel="Close"
                      hitSlop={8}
                      className="h-8 w-8 items-center justify-center rounded-full bg-surface-muted"
                      style={{ opacity: submitting ? 0.6 : 1 }}
                    >
                      <Ionicons name="close" size={16} color={INK} />
                    </Pressable>
                  </View>
                  <RNText className="text-[12.5px] leading-4" style={{ color: MUTED }}>
                    {orderNumber} will be cancelled and any reserved items released. This cannot be undone.
                  </RNText>
                </View>

                <View className="px-1 pt-3">
                  <RNText className="mb-1.5 text-[12px] font-semibold" style={{ color: INK }}>
                    Reason for cancellation
                  </RNText>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    onFocus={() => setReasonFocused(true)}
                    onBlur={() => setReasonFocused(false)}
                    multiline
                    numberOfLines={3}
                    maxLength={MAX_REASON}
                    editable={!submitting}
                    placeholder="e.g. Ordered the wrong item"
                    placeholderTextColor={MUTED}
                    // focus:outline-none suppresses Chrome's default near-black
                    // focus ring (the harsh box around the field on web); the
                    // border colour change carries the focus signal instead.
                    className="rounded-xl border px-3.5 py-2.5 text-[13.5px] focus:outline-none"
                    style={{
                      borderColor: reasonFocused ? BRAND : LINE,
                      color: INK,
                      minHeight: 76,
                      textAlignVertical: 'top',
                    }}
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

                <View className="flex-row gap-3 px-1 pt-4">
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
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

/** Re-exported so screens share one source for the destructive accent. */
export { BRAND, INK, MUTED, LINE, DANGER };
