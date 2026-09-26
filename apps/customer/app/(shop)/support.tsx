import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';

import { SubScreenHeader } from '../../src/components/navigation/SubScreenHeader';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/**
 * Contact channels, read from build config.
 *
 * These used to be hardcoded placeholders — `+919876543210` and a
 * `care@sakyafarms.example` address — which would have shipped a wrong phone
 * number and a non-existent email to real customers. They are now optional:
 * any channel that is not configured is simply not shown, so the screen can
 * never offer a contact method that does not exist.
 *
 * Set them in apps/customer/.env:
 *   EXPO_PUBLIC_SUPPORT_PHONE=+91XXXXXXXXXX
 *   EXPO_PUBLIC_SUPPORT_EMAIL=care@sakyafarms.com
 *   EXPO_PUBLIC_SUPPORT_WHATSAPP=91XXXXXXXXXX   (digits only, no +)
 */
const SUPPORT_PHONE = process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '';
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '';
const SUPPORT_WHATSAPP = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP ?? '';

const HAS_ANY_CHANNEL = SUPPORT_PHONE !== '' || SUPPORT_EMAIL !== '' || SUPPORT_WHATSAPP !== '';

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'When will my order arrive?',
    a: 'Every order page shows live status. Delivery estimates depend on your pincode — the checkout screen shows the promised window before you place the order.',
  },
  {
    q: 'How do I cancel an order?',
    a: 'Open the order from Orders and tap Cancel order. Cancellation is possible until the order is dispatched; after that you can request a return on delivery.',
  },
  {
    q: 'How do returns work?',
    a: 'Delivered orders can be returned within the return window shown on the order. Pick the item, choose a reason and submit — we review and confirm refunds to your original payment method.',
  },
  {
    q: 'My payment failed but money was deducted.',
    a: 'Failed payments auto-reconcile with the bank, usually within 5–7 working days. If the order was placed, it will still be visible in Orders.',
  },
  {
    q: 'A product I want is out of stock.',
    a: 'Tap Notify Me on the product card — we will send you a notification the moment it is back.',
  },
];

/**
 * Help & Support — FAQ, order-issue entry point and real contact actions.
 * Reachable from the Account screen and from order details.
 */
export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <SubScreenHeader title="Help & Support" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} className="gap-3">
        {/* Issue with a recent order — the most common real need */}
        <Pressable
          onPress={() => router.push('/(shop)/orders')}
          accessibilityRole="button"
          accessibilityLabel="Open your orders to report an issue"
          className="flex-row items-center gap-3 rounded-2xl border bg-white p-4"
          style={{ borderColor: LINE }}
        >
          <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: '#EDF4F0' }}>
            <Ionicons name="receipt-outline" size={16} color={BRAND} />
          </View>
          <View className="flex-1">
            <RNText className="text-[13.5px] font-semibold" style={{ color: INK }}>
              Issue with a recent order?
            </RNText>
            <RNText className="text-[11.5px]" style={{ color: MUTED }}>
              Open the order to cancel, return or track it.
            </RNText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={MUTED} />
        </Pressable>

        {/* Contact channels */}
        <RNText className="text-[13px] font-bold" style={{ color: MUTED }}>
          CONTACT US
        </RNText>
        <View className="gap-2">
          {SUPPORT_PHONE !== '' ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}
            accessibilityRole="button"
            accessibilityLabel="Call customer support"
            className="flex-row items-center gap-3 rounded-2xl border bg-white p-4"
            style={{ borderColor: LINE }}
          >
            <Ionicons name="call-outline" size={18} color={BRAND} />
            <View className="flex-1">
              <RNText className="text-[13.5px] font-semibold" style={{ color: INK }}>
                Call us
              </RNText>
              <RNText className="text-[12px]" style={{ color: MUTED }}>
                {SUPPORT_PHONE}
              </RNText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={MUTED} />
          </Pressable>
          ) : null}

          {SUPPORT_WHATSAPP !== '' ? (
          <Pressable
            onPress={() =>
              void Linking.openURL(
                `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Hi Sakya Farms, I need help with ')}`,
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Chat on WhatsApp"
            className="flex-row items-center gap-3 rounded-2xl border bg-white p-4"
            style={{ borderColor: LINE }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={BRAND} />
            <View className="flex-1">
              <RNText className="text-[13.5px] font-semibold" style={{ color: INK }}>
                WhatsApp
              </RNText>
              <RNText className="text-[12px]" style={{ color: MUTED }}>
                Chat with our farm desk
              </RNText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={MUTED} />
          </Pressable>
          ) : null}

          {SUPPORT_EMAIL !== '' ? (
          <Pressable
            onPress={() =>
              void Linking.openURL(
                `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Support request — Sakya Farms app')}`,
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Email customer support"
            className="flex-row items-center gap-3 rounded-2xl border bg-white p-4"
            style={{ borderColor: LINE }}
          >
            <Ionicons name="mail-outline" size={18} color={BRAND} />
            <View className="flex-1">
              <RNText className="text-[13.5px] font-semibold" style={{ color: INK }}>
                Email
              </RNText>
              <RNText className="text-[12px]" style={{ color: MUTED }}>
                {SUPPORT_EMAIL}
              </RNText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={MUTED} />
          </Pressable>
          ) : null}

          {HAS_ANY_CHANNEL ? null : (
            <View className="rounded-2xl border bg-white p-4" style={{ borderColor: LINE }}>
              <RNText className="text-[13px] leading-5" style={{ color: MUTED }}>
                Contact options are being set up. In the meantime, use the order
                screen to cancel, return or track an order.
              </RNText>
            </View>
          )}
        </View>

        {/* FAQ */}
        <RNText className="mt-2 text-[13px] font-bold" style={{ color: MUTED }}>
          FREQUENTLY ASKED
        </RNText>
        <View className="rounded-2xl border bg-white" style={{ borderColor: LINE }}>
          {FAQS.map((faq, index) => {
            const open = openIndex === index;
            return (
              <View key={faq.q} style={{ borderTopWidth: index > 0 ? 1 : 0, borderTopColor: LINE }}>
                <Pressable
                  onPress={() => setOpenIndex(open ? null : index)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  className="flex-row items-center justify-between p-4"
                >
                  <RNText className="flex-1 pr-3 text-[13.5px] font-semibold" style={{ color: INK }}>
                    {faq.q}
                  </RNText>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={MUTED} />
                </Pressable>
                {open ? (
                  <RNText className="px-4 pb-4 text-[12.5px] leading-5" style={{ color: MUTED }}>
                    {faq.a}
                  </RNText>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
