import { Pressable, Text as RNText, View } from 'react-native';

const INK = '#171A18';
const BRAND = '#0B594C';
const MUTED = '#8C8A80';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Renders the See All link when provided. */
  onSeeAll?: () => void;
}

/** Section title row with an optional See All link. */
export function SectionHeader({ title, subtitle, onSeeAll }: SectionHeaderProps) {
  return (
    <View className="flex-row items-end justify-between px-4">
      <View className="flex-1 gap-0.5">
        <RNText className="text-[17px] font-bold leading-6" style={{ color: INK }}>
          {title}
        </RNText>
        {subtitle ? (
          <RNText className="text-[12.5px] leading-4" style={{ color: MUTED }}>
            {subtitle}
          </RNText>
        ) : null}
      </View>
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all ${title}`}
          hitSlop={8}
          className="ml-2"
        >
          <RNText className="text-[12.5px] font-bold" style={{ color: BRAND }}>
            See All
          </RNText>
        </Pressable>
      ) : null}
    </View>
  );
}
