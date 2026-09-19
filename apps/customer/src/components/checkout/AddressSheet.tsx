import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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

import type { CheckoutAddress } from '../../api/checkout';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const DANGER = '#B42318';
const FIELD_BG = '#FCFBF6';

/**
 * AddressSheet — the checkout address form as a bottom sheet.
 *
 * Same architecture as VariantPickerSheet: a transparent Modal, a backdrop
 * Pressable that dismisses on tap (the sheet body stops propagation), and a
 * Reanimated slide-up. The form is the ENTIRE sheet body so it can scroll when
 * the keyboard is up, and the safe-area bottom inset is always honoured.
 *
 * Validation is local and dumb-by-design: required fields and an Indian
 * 6-digit pincode. The server re-checks nothing here because the address is a
 * snapshot — the authoritative validation happens at placement on the total.
 */

/** Indian postal Index File Number: exactly six digits, first non-zero. */
const PINCODE_RE = /^[1-9][0-9]{5}$/;

/** Indian mobile numbers as customers type them: 10 digits starting 6-9. */
const PHONE_RE = /^[6-9][0-9]{9}$/;

export interface AddressSheetProps {
  visible: boolean;
  /** Prefill (the last-used address). Editing starts from a copy. */
  initial?: CheckoutAddress | null;
  /** Delivery contact defaults from the signed-in session. */
  contactDefaults?: { name: string; phone: string } | null;
  /** Signed-in customers can persist the address to their server-side book. */
  canSaveToBook?: boolean;
  /** Present = the sheet also reports the customer's save-to-book choice. */
  onSave?: (address: CheckoutAddress, saveToBook: boolean) => void;
  /** Kept for backward compatibility when onSave is not provided. */
  onLegacySave?: (address: CheckoutAddress) => void;
  onClose: () => void;
}

interface FieldErrors {
  fullName?: string;
  phone?: string;
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

const EMPTY: CheckoutAddress = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
  postalCode: '',
};

export function AddressSheet({
  visible,
  initial,
  contactDefaults,
  canSaveToBook = false,
  onSave,
  onLegacySave,
  onClose,
}: AddressSheetProps) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<CheckoutAddress>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alsoSave, setAlsoSave] = useState(false);

  // Prefill every time the sheet opens: last-used address first, then the
  // session's name/phone for a first-time customer.
  useEffect(() => {
    if (!visible) return;
    setErrors({});
    setAlsoSave(false);
    setForm({
      ...EMPTY,
      ...(initial ?? {}),
      fullName: initial?.fullName || contactDefaults?.name || '',
      phone: initial?.phone || contactDefaults?.phone || '',
    });
  }, [visible, initial, contactDefaults]);

  const canSave = useMemo(
    () =>
      form.fullName.trim() !== '' &&
      PHONE_RE.test(form.phone) &&
      form.line1.trim() !== '' &&
      form.city.trim() !== '' &&
      form.state.trim() !== '' &&
      PINCODE_RE.test(form.postalCode),
    [form],
  );

  function set<K extends keyof CheckoutAddress>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function handleSave() {
    const next: FieldErrors = {};
    if (form.fullName.trim() === '') next.fullName = 'Name is required';
    if (!PHONE_RE.test(form.phone)) next.phone = 'Enter a valid 10-digit mobile number';
    if (form.line1.trim() === '') next.line1 = 'Address is required';
    if (form.city.trim() === '') next.city = 'City is required';
    if (form.state.trim() === '') next.state = 'State is required';
    if (!PINCODE_RE.test(form.postalCode)) next.postalCode = 'Enter a 6-digit pincode';

    if (Object.values(next).some((message) => message !== undefined)) {
      setErrors(next);
      return;
    }

    const cleaned: CheckoutAddress = {
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      line1: form.line1.trim(),
      line2: form.line2?.trim() ?? '',
      landmark: form.landmark?.trim() ?? '',
      city: form.city.trim(),
      state: form.state.trim(),
      postalCode: form.postalCode.trim(),
    };

    if (onSave !== undefined) {
      onSave(cleaned, alsoSave && canSaveToBook);
    } else {
      onLegacySave?.(cleaned);
    }
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
        accessibilityLabel="Dismiss address form"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable onPress={() => undefined}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Animated.View
              entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
              exiting={SlideOutDown.duration(190).easing(Easing.in(Easing.cubic))}
              className="rounded-t-[24px] bg-canvas px-4 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}
            >
              <View className="items-center pb-2">
                <View className="h-1 w-10 rounded-full bg-line" />
              </View>

              <SheetHeader onClose={onClose} />

              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                className="mt-3"
                bounces={false}
              >
                <View className="gap-3 pb-2">
                  <Field
                    label="Full name"
                    value={form.fullName}
                    onChangeText={(value) => set('fullName', value)}
                    placeholder="Name for delivery"
                    error={errors.fullName}
                    autoCapitalize="words"
                    returnKeyType="next"
                  />
                  <Field
                    label="Phone number"
                    value={form.phone}
                    onChangeText={(value) => set('phone', value.replace(/[^0-9]/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    error={errors.phone}
                    keyboardType="phone-pad"
                    maxLength={10}
                    returnKeyType="next"
                  />
                  <Field
                    label="Flat / House no., Building, Street"
                    value={form.line1}
                    onChangeText={(value) => set('line1', value)}
                    placeholder="House / flat and street"
                    error={errors.line1}
                    multiline
                    returnKeyType="next"
                  />
                  <Field
                    label="Area, Landmark (optional)"
                    value={form.landmark ?? ''}
                    onChangeText={(value) => set('landmark', value)}
                    placeholder="Nearby landmark"
                    returnKeyType="next"
                  />
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      <Field
                        label="City"
                        value={form.city}
                        onChangeText={(value) => set('city', value)}
                        placeholder="City"
                        error={errors.city}
                        autoCapitalize="words"
                        returnKeyType="next"
                      />
                    </View>
                    <View className="flex-1">
                      <Field
                        label="State"
                        value={form.state}
                        onChangeText={(value) => set('state', value)}
                        placeholder="State"
                        error={errors.state}
                        autoCapitalize="words"
                        returnKeyType="next"
                      />
                    </View>
                  </View>
                  <Field
                    label="Pincode"
                    value={form.postalCode}
                    onChangeText={(value) => set('postalCode', value.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="6-digit pincode"
                    error={errors.postalCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    returnKeyType="done"
                  />
                </View>
              </ScrollView>

              {/* Save-to-book toggle — only when the caller can persist. */}
              {canSaveToBook ? (
                <Pressable
                  onPress={() => setAlsoSave((current) => !current)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: alsoSave }}
                  accessibilityLabel="Save this address to my address book"
                  className="mt-3 flex-row items-center gap-2.5"
                >
                  <View
                    className="h-5 w-5 items-center justify-center rounded-md border-2"
                    style={{ borderColor: alsoSave ? BRAND : '#C9C4B8' }}
                  >
                    {alsoSave ? <Ionicons name="checkmark" size={13} color={BRAND} /> : null}
                  </View>
                  <RNText className="flex-1 text-[12.5px]" style={{ color: INK }}>
                    Save to my address book for next time
                  </RNText>
                </Pressable>
              ) : null}

              <Pressable
                onPress={handleSave}
                disabled={!canSave}
                accessibilityRole="button"
                accessibilityLabel="Save delivery address"
                accessibilityState={{ disabled: !canSave }}
                className={
                  'h-[50px] rounded-full bg-brand items-center justify-center mt-3' +
                  (!canSave ? ' opacity-55' : '')
                }
              >
                <RNText className="text-white text-[15px] font-bold">Save address</RNText>
              </Pressable>
            </Animated.View>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
      </Animated.View>
    </Modal>
  );
}

function SheetHeader({ onClose }: { onClose: () => void }) {
  return (
    <View className="flex-row items-center justify-between">
      <RNText className="text-[16px] font-bold" style={{ color: INK }}>
        Delivery address
      </RNText>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
        className="h-8 w-8 items-center justify-center rounded-full bg-surface-muted"
      >
        <Ionicons name="close" size={16} color={INK} />
      </Pressable>
    </View>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  error?: string | undefined;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'words';
  multiline?: boolean;
  returnKeyType?: 'done' | 'next';
  maxLength?: number;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  keyboardType = 'default',
  autoCapitalize = 'none',
  multiline = false,
  returnKeyType = 'done',
  maxLength,
}: FieldProps) {
  const invalid = error !== undefined;
  return (
    <View className="gap-1">
      <RNText className="text-[12px] font-semibold" style={{ color: MUTED }}>
        {label}
      </RNText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        returnKeyType={returnKeyType}
        maxLength={maxLength}
        accessibilityLabel={label}
        accessibilityHint={invalid ? error : undefined}
        className={
          'rounded-[12px] border px-3 text-[14px]' +
          (multiline ? ' min-h-[72px] pt-2.5' : ' h-[46px]') +
          (invalid ? ' border-danger' : ' border-line')
        }
        style={{ backgroundColor: FIELD_BG, color: INK }}
        cursorColor={BRAND}
        selectionColor={BRAND}
      />
      {invalid ? (
        <RNText className="text-[11px]" style={{ color: DANGER }} accessibilityLiveRegion="polite">
          {error}
        </RNText>
      ) : null}
    </View>
  );
}
