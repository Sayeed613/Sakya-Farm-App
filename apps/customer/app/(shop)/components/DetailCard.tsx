import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { softShadow } from '../../../src/lib/shadows';

const INK = '#171A18';
const MUTED = '#6F6C63';
const SUBTLE = '#8C8A80';
const CARD_BORDER = '#EDE7DC';

/**
 * DETAIL CARD — icon tile + title + two-line detail + chevron
 *
 * The checkout's one row shape (address, delivery, payment). `badge` swaps
 * the icon glyph for short text (the UPI mark); `children` renders below the
 * row inside the same card, which is how the payment radios expand.
 */
export default function DetailCard({
  icon,
  iconColor,
  iconBackground,
  badge,
  title,
  primary,
  secondary,
  trailingIcon = 'chevron-forward',
  trailingColor = SUBTLE,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBackground: string;
  badge?: string;
  title: string;
  primary?: string;
  secondary?: string;
  trailingIcon?: keyof typeof Ionicons.glyphMap | null;
  trailingColor?: string;
  children?: ReactNode;
}) {
  return (
    <View
      className="mx-3 mt-3 overflow-hidden rounded-[14px] border bg-white"
      style={{ borderColor: CARD_BORDER, ...softShadow }}
    >
      <View className="flex-row items-center gap-3 p-3.5">
        <View
          className="h-[38px] w-[38px] items-center justify-center rounded-full"
          style={{ backgroundColor: iconBackground }}
        >
          {badge !== undefined ? (
            <RNText className="text-[10px] font-extrabold" style={{ color: iconColor }}>
              {badge}
            </RNText>
          ) : (
            <Ionicons name={icon} size={19} color={iconColor} />
          )}
        </View>

        <View className="min-w-0 flex-1">
          <RNText className="text-[13.5px] font-bold" style={{ color: INK }}>
            {title}
          </RNText>
          {primary !== undefined ? (
            <RNText className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
              {primary}
            </RNText>
          ) : null}
          {secondary !== undefined ? (
            <RNText className="text-[11.5px] leading-[15px]" style={{ color: SUBTLE }}>
              {secondary}
            </RNText>
          ) : null}
        </View>

        {trailingIcon !== null ? <Ionicons name={trailingIcon} size={17} color={trailingColor} /> : null}
      </View>

      {children}
    </View>
  );
}
