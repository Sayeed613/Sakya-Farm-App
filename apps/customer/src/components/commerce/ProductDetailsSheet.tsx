import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';

import type { ProductDetail } from '@sakya/types';
import { formatMoney } from '../../lib/format';
import { ProductInfoAccordion, type AccordionSection } from './ProductInfoAccordion';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

export interface ProductDetailsSheetProps {
  detail: ProductDetail | null;
  selectedTitle: string | null;
  selectedPriceInPaise: number | null;
  selectedCompareAtInPaise: number | null;
  onAdd: () => void;
  onClose: () => void;
}

/**
 * ProductDetailsSheet — the "View details" information sheet (reference 3).
 *
 * Layered over the product experience: dimmed backdrop, rounded cream sheet,
 * product header, then product-specific accordion sections. Sections are built
 * ONLY from data the backend returned (description, real pack options with
 * real availability, real tags) — nothing is manufactured per category.
 *
 * The sticky bar uses the EXACT variant selected on the page underneath; the
 * sheet never holds its own variant state, so expanding/collapsing sections
 * cannot lose the selection.
 */
export function ProductDetailsSheet({
  detail,
  selectedTitle,
  selectedPriceInPaise,
  selectedCompareAtInPaise,
  onAdd,
  onClose,
}: ProductDetailsSheetProps) {
  const insets = useSafeAreaInsets();

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 24 && Math.abs(gesture.dx) < 60,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 120) onClose();
        },
      }),
    [onClose],
  );

  const sections = useMemo<AccordionSection[]>(() => {
    if (!detail) return [];
    const list: AccordionSection[] = [];
    if (detail.description != null && detail.description.trim().length > 0) {
      list.push({ key: 'description', title: 'Description', body: [detail.description.trim()] });
    }
    if (detail.variants.length > 0) {
      list.push({
        key: 'pack-options',
        title: 'Pack options',
        body: detail.variants.map(
          (variant) =>
            `${variant.title} — ${formatMoney(variant.priceInPaise)}${variant.isAvailable ? '' : ' (unavailable)'}`,
        ),
      });
    }
    if (detail.tags.length > 0) {
      list.push({ key: 'tags', title: 'More information', body: [detail.tags.join(' · ')] });
    }
    return list;
  }, [detail]);

  const hasSelection = selectedPriceInPaise != null;

  return (
    <Modal
      visible={detail != null}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss details sheet"
        onPress={onClose}
        className="flex-1 justify-end bg-black/45"
      >
        <Pressable onPress={() => undefined}>
          <Animated.View
            entering={SlideInDown.springify().damping(26).stiffness(220)}
            exiting={SlideOutDown.duration(180)}
            className="max-h-[85%] rounded-t-[24px] bg-canvas"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
            {...panResponder.panHandlers}
          >
            {/* Header: small product image + title */}
            {detail ? (
              <View className="flex-row items-center gap-3 px-4 pb-2 pt-4">
                {detail.primaryImageUrl ? (
                  <Image
                    source={{ uri: detail.primaryImageUrl }}
                    style={{ width: 44, height: 44, borderRadius: 12 }}
                    contentFit="cover"
                    cachePolicy="disk"
                    recyclingKey={detail.primaryImageUrl}
                    transition={150}
                  />
                ) : (
                  <View className="h-11 w-11 items-center justify-center rounded-xl bg-surface-muted">
                    <Ionicons name="leaf-outline" size={18} color={MUTED} />
                  </View>
                )}
                <RNText className="flex-1 text-[16px] font-bold leading-5" style={{ color: INK }} numberOfLines={2}>
                  {detail.title}
                </RNText>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close details"
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full bg-surface-muted"
                >
                  <Ionicons name="close" size={16} color={INK} />
                </Pressable>
              </View>
            ) : null}

            <ScrollView showsVerticalScrollIndicator={false} className="px-4">
              <RNText className="pb-1 pt-2 text-[16px] font-bold" style={{ color: INK }}>
                All details
              </RNText>
              {sections.length > 0 ? (
                <ProductInfoAccordion sections={sections} />
              ) : (
                <RNText className="py-4 text-[13px]" style={{ color: MUTED }}>
                  Detailed information for this product is not available yet.
                </RNText>
              )}
              <View className="h-3" />
            </ScrollView>

            {/* Sticky add bar — the page's currently selected variant. */}
            <View
              className="flex-row items-center justify-between border-t border-line bg-white px-4 pt-2.5"
              style={{ marginTop: 8, paddingBottom: 10 }}
            >
              <View>
                {hasSelection ? (
                  <View className="flex-row items-baseline gap-1.5">
                    <RNText className="text-[12.5px] font-semibold" style={{ color: MUTED }}>
                      {selectedTitle}
                    </RNText>
                    <RNText className="text-[16px] font-bold" style={{ color: INK }}>
                      {formatMoney(selectedPriceInPaise ?? 0)}
                    </RNText>
                    {selectedCompareAtInPaise != null &&
                    selectedCompareAtInPaise > (selectedPriceInPaise ?? 0) ? (
                      <RNText className="text-[11px] line-through" style={{ color: MUTED }}>
                        {formatMoney(selectedCompareAtInPaise)}
                      </RNText>
                    ) : null}
                  </View>
                ) : (
                  <RNText className="text-[12px]" style={{ color: MUTED }}>
                    No variant selected
                  </RNText>
                )}
                <RNText className="text-[10px]" style={{ color: MUTED }}>
                  Inclusive of all taxes
                </RNText>
              </View>
              <Pressable
                onPress={onAdd}
                disabled={!hasSelection}
                accessibilityRole="button"
                accessibilityLabel="Add selected variant to cart"
                accessibilityState={{ disabled: !hasSelection }}
                className={'rounded-full px-6 py-3 ' + (hasSelection ? 'active:opacity-85' : 'opacity-40')}
                style={{ backgroundColor: BRAND }}
              >
                <RNText className="text-[13.5px] font-bold text-white">Add to Cart</RNText>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
