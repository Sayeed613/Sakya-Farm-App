import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';

import type { ProductListItem } from '@sakya/types';

import { useWishlist } from '../../hooks/use-wishlist';
import { formatMoney, formatPackSize } from '../../lib/format';
import { cdnImageUri } from '../../lib/cdn-image';
import { softShadow } from '../../lib/shadows';
import { useProductAdd } from '../../lib/use-product-add';
import { useAuthStore } from '../../stores/auth-store';
import { QuantityStepper } from './QuantityStepper';

const INK = '#171A18';
const MUTED = '#8C8A80';
const GREEN = '#4D8B45';

export interface RelatedProductCardProps {
  item: ProductListItem;
  onOpen: (slug: string) => void;
}

/**
 * People also bought card
 *
 * Layout intentionally matches the reference:
 *
 * ┌────────────────────┐
 * │              ♡     │
 * │                    │
 * │      PRODUCT       │
 * │       IMAGE        │
 * │                    │
 * ├────────────── ADD ─┤
 * │ 100 g              │
 * │ ₹7                 │
 * │ Green Chilli       │
 * │ ◷ 9 mins           │
 * └────────────────────┘
 */
function RelatedProductCardInner({
  item,
  onOpen,
}: RelatedProductCardProps) {
  const {
    quantity,
    add,
    increment,
    decrement,
    resolving,
    mutating,
  } = useProductAdd(item);

  const [failed, setFailed] = useState(false);
  const { isSaved, toggle } = useWishlist();
  const liked = isSaved(item.slug);

  const soldOut =
    !item.isAvailable || item.availableVariantCount === 0;

  const packSize = formatPackSize({
    variantTitles: item.variantTitles ?? [],
    variantCount: item.variantCount,
    vendor: item.vendor,
    categoryNames: item.categories.map(
      (category) => category.name,
    ),
  });

  return (
    <View
      className="w-[132px] overflow-hidden rounded-[16px] bg-white"
      style={softShadow}
    >
      {/* IMAGE */}
      <View
        className="relative overflow-hidden rounded-t-[16px] bg-surface-muted"
        style={{
          width: '100%',
          aspectRatio: 0.87,
        }}
      >
        <Pressable
          onPress={() => onOpen(item.slug)}
          accessibilityRole="button"
          accessibilityLabel={`View ${item.title}`}
          className="h-full w-full"
        >
          {item.primaryImageUrl && !failed ? (
            <Image
              source={{ uri: cdnImageUri(item.primaryImageUrl, 160) ?? item.primaryImageUrl }}
              style={{
                width: '100%',
                height: '100%',
              }}
              /* Single-photo products (ghee jar, honey) show the full
                 uncropped image; multi-photo products fill the well. */
              contentFit={(item.imageUrls?.length ?? 0) === 1 ? 'contain' : 'cover'}
              cachePolicy="disk"
              recyclingKey={item.primaryImageUrl}
              transition={180}
              onError={() => setFailed(true)}
            />
          ) : (
            <View className="h-full w-full items-center justify-center">
              <Ionicons
                name="leaf-outline"
                size={22}
                color={MUTED}
              />
            </View>
          )}
        </Pressable>

        {/* HEART - top right, exactly over the image */}
        <Pressable
          onPress={() => {
            void toggle(item.slug).then((result) => {
              if (result === 'auth-required') {
                useAuthStore.getState().setPendingRedirect('/(shop)');
                router.push('/(auth)/phone');
              }
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={
            liked
              ? `Remove ${item.title} from favourites`
              : `Add ${item.title} to favourites`
          }
          hitSlop={8}
          className="absolute right-[7px] top-[7px] h-[23px] w-[23px] items-center justify-center"
        >
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={17}
            color="#FFFFFF"
          />
        </Pressable>
      </View>

      {/* PACK SIZE + ADD BUTTON */}
      <View className="min-h-[34px] flex-row items-center justify-between bg-white px-[7px] pt-[5px]">
        <RNText
          className="flex-1 text-[10px]"
          style={{ color: INK }}
          numberOfLines={1}
        >
          {packSize}
        </RNText>

        {soldOut ? (
          <View
            className="h-[32px] items-center justify-center rounded-[9px] border px-[9px]"
            style={{ borderColor: GREEN }}
          >
            <RNText
              className="text-[9px] font-bold"
              style={{ color: GREEN }}
            >
              Notify
            </RNText>
          </View>
        ) : quantity > 0 ? (
          <QuantityStepper
            quantity={quantity}
            disabled={resolving || mutating}
            width={70}
            onAdd={() => void add()}
            onIncrement={() => void increment()}
            onDecrement={decrement}
          />
        ) : (
          <Pressable
            onPress={() => void add()}
            disabled={resolving || mutating}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.title}`}
            className="h-[32px] min-w-[43px] items-center justify-center rounded-[9px] border bg-white px-[9px]"
            style={{
              borderColor: GREEN,
              opacity: resolving || mutating ? 0.5 : 1,
            }}
          >
            <RNText
              className="text-[11px] font-bold"
              style={{ color: GREEN }}
            >
              ADD
            </RNText>
          </Pressable>
        )}
      </View>

      {/* PRICE */}
      <View className="mt-[1px] px-[7px]">
        {item.price?.minInPaise != null ? (
          <RNText
            className="text-[12.5px] font-bold leading-[16px]"
            style={{ color: INK }}
          >
            {formatMoney(item.price.minInPaise)}
          </RNText>
        ) : (
          <RNText
            className="text-[11px] leading-[16px]"
            style={{ color: MUTED }}
          >
            —
          </RNText>
        )}
      </View>

      {/* TITLE */}
      <Pressable
        onPress={() => onOpen(item.slug)}
        hitSlop={4}
        className="mt-[1px] px-[7px] pb-[7px]"
      >
        <RNText
          className="text-[11px] font-semibold leading-[14px]"
          style={{ color: INK }}
          numberOfLines={2}
        >
          {item.title}
        </RNText>
      </Pressable>


    </View>
  );
}

export const RelatedProductCard = memo(
  RelatedProductCardInner,
);