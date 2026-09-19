import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Text as RNText, View } from 'react-native';

import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from '../../config/category-icons';
import { getCategoryImage } from '../../config/category-images';
import { AnimatedPressable, usePressScale } from '../../lib/motion';

const BRAND = '#0B594C';
const INK = '#171A18';

export interface CategoryIconProps {
  slug: string;
  label: string;
  /** Total product count in the category (badge line under the label). */
  count?: number;
  active?: boolean;
  onPress?: () => void;
  /** 'circle' matches the Fresh sidebar reference; default is the rounded square. */
  shape?: 'circle' | 'square';
  /** Compact sidebar sizing. */
  compact?: boolean;
}

/**
 * One tappable category glyph — shared by the Home strip and the Sakya Fresh
 * sidebar so the two surfaces can never drift apart visually.
 */
function CategoryIconInner({
  slug,
  label,
  count,
  active = false,
  onPress,
  shape = 'square',
  compact = false,
}: CategoryIconProps) {
  const press = usePressScale();
  const image = getCategoryImage(slug);
  const icon = (CATEGORY_ICONS[slug] ?? FALLBACK_CATEGORY_ICON) as keyof typeof Ionicons.glyphMap;
  const box = compact ? 'h-[48px] w-[48px]' : 'h-[56px] w-[56px]';
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${count != null ? `, ${count} products` : ''}`}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="items-center gap-1.5"
    >
      <View
        className={
          box + ' ' + radius + ' items-center justify-center overflow-hidden border ' +
          (active ? 'border-brand bg-brand/10' : 'border-line bg-white')
        }
      >
        {image ? (
          <Image
            source={image}
            style={compact ? { width: 58, height: 58 } : { width: 56, height: 56 }}
            contentFit="contain"
            cachePolicy="memory"
            recyclingKey={slug}
            transition={100}
          />
        ) : (
          <Ionicons name={icon} size={compact ? 20 : 22} color={active ? BRAND : '#4A5A50'} />
        )}
        {/* Active green indicator bar on the RIGHT edge (Fresh sidebar reference). */}
        {/* {active ? (
          <View
            className="absolute -right-1.5 top-2 bottom-2 w-[3px] rounded-full"
            style={{ backgroundColor: BRAND }}
          />
        ) : null} */}
      </View>
      <RNText
        className={
          (compact ? 'w-[68px] text-[10.5px] leading-3' : 'w-[64px] text-[11px] leading-3.5') +
          ' text-center ' + (active ? 'font-bold' : 'font-semibold')
        }
        style={{ color: active ? BRAND : INK }}
        numberOfLines={2}
      >
        {label}
      </RNText>
      {count != null ? (
        <RNText className="text-[10px]" style={{ color: '#8C8A80' }}>
          {count}
        </RNText>
      ) : null}
    </AnimatedPressable>
  );
}

export const CategoryIcon = memo(CategoryIconInner);
