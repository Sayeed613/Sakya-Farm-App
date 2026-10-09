import { useQuery } from '@tanstack/react-query';
import { Modal, Pressable, ScrollView, Text as RNText, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';

import { journeyApi } from '../../api/journey';
import { formatMoney } from '../../lib/format';
import { sheetMaxContentHeight } from '../../lib/layout-metrics';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

/**
 * Invoice sheet — renders `GET /orders/:orderId/invoice` verbatim.
 *
 * The server computes every number and owns the billed-to snapshot; this view
 * formats but never re-derives. Errors (not yours, not invoiceable, offline)
 * render with a retry.
 */
export function InvoiceSheet({
  visible,
  orderId,
  onClose,
}: {
  visible: boolean;
  orderId: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const invoice = useQuery({
    queryKey: ['invoice', orderId],
    queryFn: () => journeyApi.getInvoice(orderId as string),
    enabled: visible && orderId !== null,
    staleTime: 5 * 60_000,
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40">
        <Pressable accessibilityLabel="Close invoice" className="flex-1" onPress={onClose} />
        <Animated.View
          entering={SlideInDown.springify().damping(22)}
          exiting={SlideOutDown}
          className="rounded-t-3xl bg-white"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="items-center pt-2.5">
            <View className="h-1 w-10 rounded-full" style={{ backgroundColor: LINE }} />
          </View>
          <View className="flex-row items-center gap-2 px-5 pt-3">
            <Ionicons name="receipt-outline" size={18} color={BRAND} />
            <RNText className="flex-1 text-[16px] font-bold" style={{ color: INK }}>
              Invoice
            </RNText>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close invoice">
              <Ionicons name="close" size={20} color={MUTED} />
            </Pressable>
          </View>

          {/* Responsive cap: a flat 480 clipped the sheet's header/actions on
              short phones; this scales with the real screen so long invoices
              still scroll to the total while the sheet always fits. */}
          <ScrollView
            className="px-5 pt-3"
            style={{ maxHeight: sheetMaxContentHeight(windowHeight) }}
          >
            {invoice.isPending ? (
              <RNText className="py-8 text-center text-[13px]" style={{ color: MUTED }}>
                Loading invoice…
              </RNText>
            ) : invoice.isError ? (
              <View className="items-center gap-3 py-8">
                <Ionicons name="cloud-offline-outline" size={28} color={MUTED} />
                <RNText className="text-center text-[13px]" style={{ color: MUTED }}>
                  The invoice could not be loaded right now.
                </RNText>
                <Pressable
                  onPress={() => void invoice.refetch()}
                  className="rounded-full border px-4 py-2"
                  style={{ borderColor: BRAND }}
                >
                  <RNText className="text-[12.5px] font-bold" style={{ color: BRAND }}>
                    Retry
                  </RNText>
                </Pressable>
              </View>
            ) : invoice.data ? (
              <View className="gap-3">
                {/* Header */}
                <View>
                  <RNText className="text-[15px] font-bold" style={{ color: INK }}>
                    {invoice.data.orderNumber}
                  </RNText>
                  <RNText className="text-[12px]" style={{ color: MUTED }}>
                    {invoice.data.placedAt !== null
                      ? new Date(invoice.data.placedAt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : null}
                    {' · '}
                    {invoice.data.paymentMethod ?? 'Payment pending'} ({invoice.data.paymentStatus})
                  </RNText>
                </View>

                {/* Billed to */}
                <View className="rounded-xl border p-3" style={{ borderColor: LINE }}>
                  <RNText className="text-[11px] font-bold" style={{ color: MUTED }}>
                    BILLED TO
                  </RNText>
                  <RNText className="mt-1 text-[12.5px] leading-5" style={{ color: INK }}>
                    {invoice.data.billedTo.name}
                    {'\n'}
                    {invoice.data.billedTo.phone}
                    {'\n'}
                    {[invoice.data.billedTo.line1, invoice.data.billedTo.line2, invoice.data.billedTo.city, invoice.data.billedTo.state, invoice.data.billedTo.postalCode]
                      .filter((part): part is string => typeof part === 'string' && part.length > 0)
                      .join(', ')}
                  </RNText>
                </View>

                {/* Lines */}
                <View className="gap-2">
                  {invoice.data.lines.map((line, index) => (
                    <View
                      // Lines are positional data of one immutable snapshot.
                      key={`${index}-${line.sku ?? line.productTitle}`}
                      className="flex-row items-start justify-between gap-3"
                    >
                      <View className="flex-1">
                        <RNText className="text-[12.5px] font-semibold" style={{ color: INK }}>
                          {line.productTitle}
                        </RNText>
                        <RNText className="text-[11px]" style={{ color: MUTED }}>
                          {line.variantTitle} · Qty {line.quantity}
                        </RNText>
                      </View>
                      <RNText className="text-[12.5px] font-bold" style={{ color: INK }}>
                        {formatMoney(line.totalInPaise)}
                      </RNText>
                    </View>
                  ))}
                </View>

                {/* Totals */}
                <View className="gap-1.5 border-t pt-2" style={{ borderColor: LINE }}>
                  <Row label="Subtotal" value={formatMoney(invoice.data.subtotalInPaise)} />
                  {invoice.data.discountInPaise > 0 ? (
                    <Row label={`Discount${invoice.data.couponCode !== null ? ` (${invoice.data.couponCode})` : ''}`} value={`−${formatMoney(invoice.data.discountInPaise)}`} />
                  ) : null}
                  {invoice.data.taxInPaise > 0 ? (
                    <Row label="Tax" value={formatMoney(invoice.data.taxInPaise)} />
                  ) : null}
                  <Row label="Shipping" value={formatMoney(invoice.data.shippingInPaise)} />
                  <View className="mt-1 flex-row items-center justify-between">
                    <RNText className="text-[13.5px] font-bold" style={{ color: INK }}>
                      Total
                    </RNText>
                    <RNText className="text-[14px] font-bold" style={{ color: BRAND }}>
                      {formatMoney(invoice.data.totalInPaise)}
                    </RNText>
                  </View>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <RNText className="text-[12.5px]" style={{ color: MUTED }}>
        {label}
      </RNText>
      <RNText className="text-[12.5px] font-semibold" style={{ color: INK }}>
        {value}
      </RNText>
    </View>
  );
}
