import { Image } from 'expo-image';
import { Pressable, Text as RNText, View, type ImageSourcePropType } from 'react-native';

const INK = '#171A18';
const MUTED = '#8C8A80';
const BRAND = '#0B594C';

/**
 * Shared empty-state: the supplied illustration + title + message + optional
 * CTA. One component everywhere so the empty states stay consistent (cart,
 * orders, search, address book).
 */
export function EmptyState({
  image,
  title,
  message,
  ctaLabel,
  onCta,
}: {
  image: ImageSourcePropType;
  title: string;
  message: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-10">
      <Image
        source={image}
        style={{ width: 190, height: 145, marginBottom: 8 }}
        contentFit="contain"
        cachePolicy="disk"
        accessibilityRole="image"
        accessibilityLabel={title}
      />
      <RNText className="text-center text-[16px] font-bold" style={{ color: INK }}>
        {title}
      </RNText>
      <RNText className="text-center text-[13.5px] leading-5" style={{ color: MUTED }}>
        {message}
      </RNText>
      {ctaLabel !== undefined && onCta !== undefined ? (
        <Pressable
          onPress={onCta}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          className="mt-3 rounded-full px-7 py-3"
          style={{ backgroundColor: BRAND }}
        >
          <RNText className="text-[14px] font-bold text-white">{ctaLabel}</RNText>
        </Pressable>
      ) : null}
    </View>
  );
}
