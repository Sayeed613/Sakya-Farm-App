import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text as RNText, View } from 'react-native';
import type { OnlinePaymentMethod } from '../../../src/api/checkout';

import DetailCard from './DetailCard';
import { paymentCopy } from '../../../src/lib/paymentCopy';

const INK = '#171A18';
const MUTED = '#6F6C63';
const LINE = '#EFEAE1';
const BRAND = '#0B594C';
const BRAND_TINT = 'rgba(11, 89, 76, 0.08)';
const SURFACE_MUTED = '#F3EDE3';

interface PaymentMethodSelectionProps {
  method: 'COD' | OnlinePaymentMethod;
  onMethodChange: (method: 'COD' | OnlinePaymentMethod) => void;
  isOnlinePaymentsEnabled: boolean;
}

/** Small DEMO pill for a method the simulator would answer, never a live charge. */
function DemoBadge() {
  if (process.env.EXPO_PUBLIC_PAYMENTS_DEMO !== 'true') return null;
  return (
    <View className="rounded-full px-1.5 py-0.5" style={{ backgroundColor: '#F3EDE3' }}>
      <RNText className="text-[8.5px] font-bold" style={{ color: MUTED }}>
        DEMO
      </RNText>
    </View>
  );
}

interface MethodOption {
  method: 'COD' | OnlinePaymentMethod;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
}

/**
 * Payment-method card with COD / UPI / Card as THREE SIDE-BY-SIDE tiles —
 * one flex row, equal width, no dropdown and no vertical radio stack: the
 * whole choice is visible (and tappable) in a single glance, matching the
 * reference's compact method strip. The header still summarises the current
 * choice; payment failures render on checkout's place-order bar, next to the
 * action they block — not here.
 */
export default function PaymentMethodSelection({
  method,
  onMethodChange,
  isOnlinePaymentsEnabled,
}: PaymentMethodSelectionProps) {
  const demo = process.env.EXPO_PUBLIC_PAYMENTS_DEMO === 'true';
  const options: MethodOption[] = [
    { method: 'COD', icon: 'cash-outline', title: 'COD', caption: 'Pay on delivery' },
    ...(isOnlinePaymentsEnabled
      ? ([
          {
            method: 'UPI',
            icon: 'phone-portrait-outline',
            title: 'UPI',
            caption: demo ? 'Pay with any UPI app' : 'GPay · PhonePe · Paytm',
          },
          {
            method: 'CARD',
            icon: 'card-outline',
            title: 'Card',
            caption: 'Visa · Mastercard · RuPay',
          },
        ] satisfies MethodOption[])
      : []),
  ];

  return (
    <DetailCard
      icon={method === 'COD' ? 'cash-outline' : 'card-outline'}
      iconColor={INK}
      iconBackground="#F1EEE6"
      badge={method === 'UPI' ? 'UPI' : undefined}
      title="Payment Method"
      primary={paymentCopy(method).title}
      secondary={paymentCopy(method).blurb}
      trailingIcon={null}
    >
      <>
        <View className="h-px" style={{ backgroundColor: LINE }} />
        <View className="flex-row gap-2 p-3">
          {options.map((option) => {
            const selected = method === option.method;
            return (
              <Pressable
                key={option.method}
                onPress={() => onMethodChange(option.method)}
                accessibilityRole="radio"
                accessibilityLabel={`${option.title} — ${option.caption}`}
                accessibilityState={{ selected }}
                className="flex-1 items-center rounded-[12px] border px-1.5 pb-2.5 pt-3 active:opacity-80"
                style={{
                  borderColor: selected ? BRAND : LINE,
                  backgroundColor: selected ? BRAND_TINT : '#FFFFFF',
                }}
              >
                <View
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: selected ? BRAND : SURFACE_MUTED }}
                >
                  <Ionicons
                    name={option.icon}
                    size={17}
                    color={selected ? '#FFFFFF' : INK}
                  />
                </View>

                <RNText
                  className="mt-1.5 text-[12.5px] font-bold"
                  style={{ color: INK }}
                  numberOfLines={1}
                >
                  {option.title}
                </RNText>
                <RNText
                  className="text-center text-[9.5px] leading-[12.5px]"
                  style={{ color: MUTED }}
                  numberOfLines={2}
                >
                  {option.caption}
                </RNText>

                {option.method !== 'COD' ? (
                  <View className="mt-1">
                    <DemoBadge />
                  </View>
                ) : null}

                <View
                  className="absolute right-1.5 top-1.5 h-4 w-4 items-center justify-center rounded-full border-2"
                  style={{ borderColor: selected ? BRAND : LINE }}
                >
                  {selected ? (
                    <View
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: BRAND }}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </>
    </DetailCard>
  );
}
