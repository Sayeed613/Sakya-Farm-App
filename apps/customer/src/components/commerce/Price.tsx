import { Text as RNText, View } from 'react-native';

import { formatMoney } from '../../lib/format';

export type PriceSize = 'sm' | 'md' | 'lg';

const sizeStyles: Record<PriceSize, { current: string; compare: string }> = {
  sm: { current: 'text-[13.5px] font-bold text-ink', compare: 'text-[11px] text-ink-soft line-through' },
  md: { current: 'text-[15px] font-bold text-ink', compare: 'text-[12.5px] text-ink-soft line-through' },
  lg: { current: 'text-[22px] font-bold text-ink', compare: 'text-[14px] text-ink-soft line-through' },
};

export interface PriceProps {
  /** Server price in paise. */
  amountInPaise: number | null | undefined;
  /** Server compare-at price in paise, when the API supplies one. */
  compareAtInPaise?: number | null;
  size?: PriceSize;
}

/**
 * Price display with an optional compare-at price. Renders an honest
 * "Price unavailable" when the API has no price for the product — a wrong ₹0 is
 * worse than none.
 */
export function Price({ amountInPaise, compareAtInPaise, size = 'md' }: PriceProps) {
  if (amountInPaise == null) {
    return <RNText className="text-[12.5px] text-ink-soft">Price unavailable</RNText>;
  }
  return (
    <View className="flex-row items-baseline gap-1.5">
      <RNText className={sizeStyles[size].current}>{formatMoney(amountInPaise)}</RNText>
      {compareAtInPaise != null && compareAtInPaise > amountInPaise ? (
        <RNText className={sizeStyles[size].compare}>{formatMoney(compareAtInPaise)}</RNText>
      ) : null}
    </View>
  );
}
