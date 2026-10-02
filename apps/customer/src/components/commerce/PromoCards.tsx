import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text as RNText, View } from 'react-native';

import { formatMoney } from '../../lib/format';
import { softShadow } from '../../lib/shadows';

const INK = '#171A18';
const MUTED = '#6F6C63';
const BRAND = '#0B594C';
const GREEN = '#1F7A43';
const ACCENT = '#B4612F';
const ACCENT_TINT = '#F7E9DD';

/** SAKYA100: ₹100 off orders at/above ₹1999 (server-enforced minimum). */
const SAKYA100_MIN_ORDER = 199900;

/**
 * Commerce promo card (cart + checkout) — the SAKYA100 standing offer.
 *
 * Honest live state: the card only READs the server cart's totals — it never
 * computes money on the client. The coupon minimum comes from the same
 * pricing config the API enforces. The delivery charge itself is NOT
 * advertised here (no free-delivery claim): it lives in Price Details,
 * computed server-side.
 *
 * `applyCoupon` (cart screen): pressing the card applies the code directly
 * through the server. Without it (checkout) the card falls back to
 * `onPickCoupon`, e.g. navigating to the cart where the coupon box lives.
 *
 * Margins: the component deliberately carries NO horizontal margin — callers
 * decide the inset, so the cards line up with their neighbours (the cart's
 * bottom stack already pads; checkout's scroll does not).
 */
export function PromoCards({
  subtotalInPaise,
  couponCode,
  onPickCoupon,
  applyCoupon,
  applyError = null,
  applying = false,
}: {
  subtotalInPaise: number;
  couponCode: string | null;
  onPickCoupon: () => void;
  applyCoupon?: (code: string) => void;
  /** Visible server failure from the last apply attempt (cart shows it). */
  applyError?: string | null;
  applying?: boolean;
}) {
  const couponUnlocked = subtotalInPaise >= SAKYA100_MIN_ORDER;
  const remainingForCoupon = Math.max(0, SAKYA100_MIN_ORDER - subtotalInPaise);

  return (
    <View className="mt-3 gap-2.5">
      {/* SAKYA100 coupon. With a direct apply handler (cart), the
          card is pressable only when the order actually qualifies — tapping
          below the minimum would just 400 against the server's rule. Without
          one (checkout), it routes to the cart where the code can be applied
          once the basket is big enough. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="SAKYA100 coupon — ₹100 off orders above ₹1999"
        disabled={couponCode === 'SAKYA100' || (applyCoupon !== undefined && !couponUnlocked)}
        onPress={
          couponCode === 'SAKYA100'
            ? undefined
            : applyCoupon !== undefined
              ? () => applyCoupon('SAKYA100')
              : onPickCoupon
        }
        className="rounded-[14px] border bg-white p-3.5 active:opacity-85"
        style={{
          borderColor: couponCode === 'SAKYA100' ? '#CDE7DC' : BRAND,
          borderWidth: couponCode === 'SAKYA100' ? 1 : 1.4,
          ...softShadow,
        }}
      >
        <View className="flex-row items-center gap-2.5">
          <View className="h-[34px] w-[34px] items-center justify-center rounded-[10px]" style={{ backgroundColor: ACCENT_TINT }}>
            <Ionicons name="ticket" size={17} color={ACCENT} />
          </View>
          <View className="min-w-0 flex-1">
            <RNText className="text-[13px] font-bold" style={{ color: INK }}>
              {couponCode === 'SAKYA100' ? 'SAKYA100 applied — ₹100 off' : 'SAKYA100 — ₹100 off'}
            </RNText>
            <RNText className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
              {couponCode === 'SAKYA100'
                ? 'Savings show in Price Details.'
                : couponUnlocked
                  ? 'Tap to apply and save ₹100 on this order.'
                  : `On orders above ₹1,999 · add ${formatMoney(remainingForCoupon)} more to qualify`}
            </RNText>
          </View>
          {couponCode === 'SAKYA100' ? (
            <Ionicons name="checkmark-circle" size={18} color={GREEN} />
          ) : couponUnlocked ? (
            <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: BRAND }}>
              <RNText className="text-[10.5px] font-bold" style={{ color: '#FFFFFF' }}>
                {applying ? '…' : 'APPLY'}
              </RNText>
            </View>
          ) : null}
        </View>
      </Pressable>
      {applyError !== null && couponCode !== 'SAKYA100' ? (
        <RNText accessibilityLiveRegion="polite" className="mt-1.5 text-[11px] font-semibold" style={{ color: '#B42318' }}>
          {applyError}
        </RNText>
      ) : null}
    </View>
  );
}
