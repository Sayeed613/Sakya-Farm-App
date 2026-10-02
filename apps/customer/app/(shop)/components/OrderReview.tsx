import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Pressable, Text as RNText, View } from 'react-native';
import type { CartResponse } from '@sakya/types';

import { formatMoney } from '../../../src/lib/format';
import { softShadow } from '../../../src/lib/shadows';

const INK = '#171A18';
const MUTED = '#6F6C63';
const SUBTLE = '#8C8A80';
const GREEN = '#1F7A43';
const SURFACE_MUTED = '#F3EDE3';
const CARD_BORDER = '#EDE7DC';

interface OrderReviewProps {
  cart: CartResponse;
  itemCount: number;
  onEditCart: () => void;
}

/**
 * REVIEW — order items (with imagery) + the server cart's price breakdown.
 *
 * checkout.tsx owns the hero, progress row, payment selection and the
 * place-order bar; this component is the review content inside the screen's
 * single ScrollView, so it renders no nested scroller and no second CTA.
 */
export default function OrderReview({ cart, itemCount, onEditCart }: OrderReviewProps) {
  return (
    <>
      {/* Order items — what is actually being approved, from the server
          cart, WITH the product imagery. No client math. */}
      <View className="mx-3 mt-3.5">
        <View className="mb-2 flex-row items-center justify-between px-1">
          <RNText className="text-[14px] font-extrabold" style={{ color: INK }}>
            {`Order items (${itemCount})`}
          </RNText>
          <Pressable
            onPress={onEditCart}
            accessibilityRole="button"
            accessibilityLabel="Edit order items"
            hitSlop={8}
            className="active:opacity-60"
          >
            <RNText className="text-[12.5px] font-bold" style={{ color: '#0B594C' }}>
              Edit
            </RNText>
          </Pressable>
        </View>

        <View
          className="flex-row items-center gap-2.5 rounded-[14px] border bg-white p-2.5"
          style={{ borderColor: CARD_BORDER, ...softShadow }}
        >
          {cart.items.slice(0, 3).map((item) => (
            <View
              key={item.id}
              className="items-center justify-center overflow-hidden rounded-[10px]"
              style={{ backgroundColor: SURFACE_MUTED, height: 62, width: 62 }}
            >
              {item.productImageUrl !== null ? (
                <ExpoImage
                  source={{ uri: item.productImageUrl }}
                  style={{ width: 62, height: 62 }}
                  contentFit="cover"
                  cachePolicy="disk"
                  recyclingKey={item.id}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <Ionicons name="leaf-outline" size={20} color={SUBTLE} />
              )}
            </View>
          ))}

          <View className="flex-1 items-end">
            <Pressable
              onPress={onEditCart}
              accessibilityRole="button"
              accessibilityLabel="Review all items"
              className="h-[34px] w-[34px] items-center justify-center rounded-full active:opacity-70"
              style={{ backgroundColor: '#F4F1E9' }}
            >
              <Ionicons name="chevron-forward" size={16} color={INK} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* Price details — the server cart's own numbers, verbatim. */}
      <View
        className="mx-3 mt-3 rounded-[14px] border bg-white px-3.5 py-3.5"
        style={{ borderColor: CARD_BORDER, ...softShadow }}
      >
        <RNText className="mb-2.5 text-[14px] font-extrabold" style={{ color: INK }}>
          Price Details
        </RNText>

        <View className="mb-1.5 flex-row items-center justify-between">
          <RNText className="text-[12.5px]" style={{ color: MUTED }}>
            {`Items total (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`}
          </RNText>
          <RNText className="text-[12.5px] font-semibold" style={{ color: INK }}>
            {formatMoney(cart.subtotalInPaise)}
          </RNText>
        </View>

        {cart.discountInPaise > 0 ? (
          <View className="mb-1.5 flex-row items-center justify-between">
            <RNText className="text-[12.5px]" style={{ color: MUTED }}>
              {cart.coupon !== null ? `Discount (Coupon: ${cart.coupon.code})` : 'Discount'}
            </RNText>
            <RNText className="text-[12.5px] font-semibold" style={{ color: GREEN }}>
              {`−${formatMoney(cart.discountInPaise)}`}
            </RNText>
          </View>
        ) : null}

        {/* Taxes are inclusive in the displayed prices — no tax row is
            ever added. The fine print says so once, below the total. */}

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1">
            <RNText className="text-[12.5px]" style={{ color: MUTED }}>
              Delivery charges
            </RNText>
            <Ionicons name="information-circle-outline" size={13} color={SUBTLE} />
          </View>

          {cart.shippingInPaise > 0 ? (
            <RNText className="text-[12.5px] font-semibold" style={{ color: INK }}>
              {formatMoney(cart.shippingInPaise)}
            </RNText>
          ) : (
            <RNText className="text-[12.5px] font-semibold" style={{ color: GREEN }}>
              FREE
            </RNText>
          )}
        </View>

        {/* The delivery line above IS the free-delivery signal (FREE vs a
            amount); the old "Free delivery unlocked" banner row that sat
            under it was removed — one delivery answer, no duplicate. */}

        <View
          className="mt-2.5 flex-row items-center justify-between border-t pt-2.5"
          style={{ borderColor: '#EFEAE1' }}
        >
          <RNText className="text-[14.5px] font-extrabold" style={{ color: INK }}>
            Total amount
          </RNText>
          <RNText className="text-[15.5px] font-extrabold" style={{ color: INK }}>
            {formatMoney(cart.totalInPaise)}
          </RNText>
        </View>
        <RNText className="mt-2 text-[10.5px] leading-[14px]" style={{ color: SUBTLE }}>
          Prices are inclusive of all applicable taxes.
        </RNText>
      </View>
    </>
  );
}
