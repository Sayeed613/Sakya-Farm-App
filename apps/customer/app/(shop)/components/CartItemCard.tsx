import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, Text as RNText, View } from 'react-native';
import { formatMoney } from '../../../src/lib/format';

import type { CartItemResponse } from '@sakya/types';

interface CartItemCardProps {
  item: CartItemResponse;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  updateError: string | null;
  removeError: string | null;
}

export default function CartItemCard({
  item,
  busy,
  onQuantity,
  onRemove,
  updateError,
  removeError,
}: CartItemCardProps) {
  const SUBTLE = '#8C8A80';
  const GREEN = '#1F7A43';
  const ACCENT = '#B4612F';

  return (
    <View
      className={`mx-3 mt-3 rounded-[16px] bg-white p-3${
        item.isAvailable ? '' : ' opacity-55'
      }`}
      style={{
        boxShadow: '0px 2px 6px rgba(58,53,43,0.05)',
        elevation: 1,
      }}
    >
      <View className="flex-row gap-3">
        {/* ---------------- THUMBNAIL ---------------- */}
        <View className="h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-[12px] bg-[#F3EDE3]">
          {item.productImageUrl !== null ? (
            <Image
              source={{ uri: item.productImageUrl }}
              style={{ width: 76, height: 76 }}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={item.id}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Ionicons name="leaf-outline" size={22} color={SUBTLE} />
          )}
        </View>

        {/* ---------------- TITLE / VARIANT / PRICE / STEPPER ---------------- */}
        <View className="min-w-0 flex-1">
          <View className="flex-row items-start">
            <View className="min-w-0 flex-1 pr-2">
              <RNText
                numberOfLines={2}
                className="text-[13.5px] leading-[18px] font-bold text-ink"
              >
                {item.productTitle}
              </RNText>

              {item.variantTitle !== '' ? (
                <RNText
                  numberOfLines={1}
                  className="mt-0.5 text-[11.5px] leading-[15px] text-[#6F6C63]"
                >
                  {item.variantTitle}
                </RNText>
              ) : null}
            </View>

            {/* Plain grey trash, top-right. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.productTitle}`}
              hitSlop={8}
              disabled={busy}
              onPress={onRemove}
              className="active:opacity-60"
            >
              <Ionicons name="trash-outline" size={18} color={SUBTLE} />
            </Pressable>
          </View>

          {/* Price left, stepper right — one row spanning the card. */}
          <View className="mt-2 flex-row items-center justify-between">
            <RNText className="text-[14px] font-extrabold text-ink">
              {formatMoney(item.lineTotalInPaise)}
            </RNText>

            <View
              className="h-[34px] min-w-[104px] flex-row items-center justify-between rounded-full px-1.5"
              style={{ backgroundColor: GREEN }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                hitSlop={6}
                disabled={busy}
                onPress={() => onQuantity(item.quantity - 1)}
                className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
              >
                <RNText className="text-[19px] leading-[23px] font-bold text-white">−</RNText>
              </Pressable>

              <RNText className="min-w-[20px] text-center text-[14px] font-extrabold text-white">
                {item.quantity}
              </RNText>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                hitSlop={6}
                disabled={busy}
                onPress={() => onQuantity(item.quantity + 1)}
                className="h-[28px] w-[28px] items-center justify-center active:opacity-70"
              >
                <RNText className="text-[19px] leading-[23px] font-bold text-white">+</RNText>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {updateError !== null ? (
        <View className="mt-2 flex-row items-center gap-2">
          <Ionicons name="alert-circle-outline" size={14} color="#B3453E" />
          <RNText className="text-[11px] font-semibold" style={{ color: '#B3453E' }}>
            {updateError}
          </RNText>
        </View>
      ) : null}

      {removeError !== null ? (
        <View className="mt-2 flex-row items-center gap-2">
          <Ionicons name="alert-circle-outline" size={14} color="#B3453E" />
          <RNText className="text-[11px] font-semibold" style={{ color: '#B3453E' }}>
            {removeError}
          </RNText>
        </View>
      ) : null}

      {item.isAvailable ? null : (
        <RNText
          className="mt-2 text-[11px] font-semibold"
          style={{ color: ACCENT }}
        >
          Currently unavailable — remove it to check out.
        </RNText>
      )}
    </View>
  );
}