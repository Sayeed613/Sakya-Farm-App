import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View, Pressable, Text as RNText } from 'react-native';

import type { AppliedCouponResponse } from '@sakya/types';

import { CouponBox } from '../../../src/components/cart/CouponBox';

interface ApplyCouponCardProps {
  coupon: AppliedCouponResponse | null;
  subtotalInPaise: number;
  forceOpen?: boolean;
}

/*
 * Collapsed by default — the reference shows a one-line row, not an open
 * field. `forceOpen` (checkout) starts expanded so the pre-selected code is
 * visible on arrival; the customer can still fold it away. An applied coupon
 * forces the expanded state so its Remove action is reachable without
 * another tap.
 */
export default function ApplyCouponCard({
  coupon,
  subtotalInPaise,
  forceOpen = false,
}: ApplyCouponCardProps) {
  const [expanded, setExpanded] = useState(forceOpen);
  const open = expanded || coupon !== null;

  const SUBTLE = '#8C8A80';
  const ACCENT = '#B4612F';
  const LINE = '#E9E3D8';

  return (
    <View className="mt-3 overflow-hidden rounded-[16px] bg-white">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide coupon field' : 'Apply coupon code'}
        accessibilityState={{ expanded: open }}
        disabled={coupon !== null}
        onPress={() => setExpanded((value) => !value)}
        className="h-[52px] flex-row items-center gap-3 px-3.5 active:opacity-80"
      >
        <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-[#F7E9DD]">
          <Ionicons name="ticket-outline" size={17} color={ACCENT} />
        </View>

        <View className="min-w-0 flex-1">
          <RNText className="text-[13.5px] font-bold text-ink">
            {coupon === null ? 'Apply coupon code' : 'Coupon applied'}
          </RNText>
          <RNText className="text-[11px] text-[#8C8A80]">
            {coupon === null ? 'Get exciting offers and discounts' : 'Savings are included in your order total'}
          </RNText>
        </View>

        {coupon === null ? (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-forward'}
            size={18}
            color={SUBTLE}
          />
        ) : null}
      </Pressable>

      {open ? (
        <View
          className="border-t px-3.5 py-3"
          style={{ borderColor: LINE }}
        >
          <CouponBox
            coupon={coupon}
            initialCode="SAKYA100"
            subtotalInPaise={subtotalInPaise}
            minimumInPaise={199_900}
          />
        </View>
      ) : null}
    </View>
  );
}