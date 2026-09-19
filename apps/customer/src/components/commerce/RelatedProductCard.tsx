import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import type { ProductListItem } from '@sakya/types';
import { formatMoney, formatPackSize } from '../../lib/format';
import { useProductAdd } from '../../lib/use-product-add';
import { QuantityStepper } from './QuantityStepper';

const INK = '#171A18';
const MUTED = '#8C8A80';

export interface RelatedProductCardProps {
  item: ProductListItem;
  onOpen: (slug: string) => void;
}

/**
 * One "People also bought" card on the detail page: real image, title, pack
 * size, price and a working ADD. Multi-variant related products add their
 * default available variant here (the card is a quick-add surface; full
 * variant choice lives one tap away on the product page / quick view).
 */
function RelatedProductCardInner({ item, onOpen }: RelatedProductCardProps) {
  const { quantity, add, increment, decrement, resolving } = useProductAdd(item);
  const [failed, setFailed] = useState(false);

  const soldOut = !item.isAvailable || item.availableVariantCount === 0;

  return (
    <View className="w-[132px] overflow-hidden rounded-2xl border border-line bg-white">
      <Pressable
        onPress={() => onOpen(item.slug)}
        accessibilityRole="button"
        accessibilityLabel={`View ${item.title}`}
        className="bg-surface-muted"
      >
        {item.primaryImageUrl && !failed ? (
          <Image
            source={{ uri: item.primaryImageUrl }}
            style={{ width: '100%', aspectRatio: 1 }}
            contentFit="cover"
            cachePolicy="disk"
            recyclingKey={item.primaryImageUrl}
            transition={180}
            onError={() => setFailed(true)}
          />
        ) : (
          <View style={{ width: '100%', aspectRatio: 1 }} className="items-center justify-center">
            <Ionicons name="leaf-outline" size={20} color={MUTED} />
          </View>
        )}
      </Pressable>
      <View className="gap-0.5 px-2 pb-2 pt-1.5">
        <Pressable onPress={() => onOpen(item.slug)} hitSlop={4}>
          <RNText className="text-[12px] font-semibold leading-4" style={{ color: INK }} numberOfLines={2}>
            {item.title}
          </RNText>
        </Pressable>
        <RNText className="text-[10px]" style={{ color: MUTED }} numberOfLines={1}>
          {formatPackSize({
            variantTitles: item.variantTitles ?? [],
            variantCount: item.variantCount,
            vendor: item.vendor,
            categoryNames: item.categories.map((category) => category.name),
          })}
        </RNText>
        <View className="mt-0.5 flex-row items-center justify-between">
          {item.price?.minInPaise != null ? (
            <RNText className="text-[12.5px] font-bold" style={{ color: INK }}>
              {formatMoney(item.price.minInPaise)}
            </RNText>
          ) : (
            <RNText className="text-[11px]" style={{ color: MUTED }}>—</RNText>
          )}
          {soldOut ? (
            <View className="rounded-md border border-line px-1.5 py-0.5">
              <RNText className="text-[9.5px] font-bold" style={{ color: MUTED }}>
                Notify Me
              </RNText>
            </View>
          ) : (
            <QuantityStepper
              quantity={quantity}
              disabled={resolving}
              width={76}
              onAdd={() => void add()}
              onIncrement={() => void increment()}
              onDecrement={decrement}
            />
          )}
        </View>
      </View>
    </View>
  );
}

export const RelatedProductCard = memo(RelatedProductCardInner);
