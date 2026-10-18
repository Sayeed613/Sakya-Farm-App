import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';

import type { ProductListItem } from '@sakya/types';
import { deriveBadges, deriveMerchBadges } from '../../lib/product-badges';

const ADD_GREEN = '#0C831F'; // Blinkit action green
const RUST = '#B4612F';
const MUSTARD = '#C99A2E';

/** One badge pill: icon + label on a white glass chip. */
function BadgePill({ icon, label, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }) {
  return (
    <View
      className="flex-row items-center gap-1 rounded-full px-1.5 py-0.5"
      style={{ backgroundColor: 'rgba(255,255,255,0.94)' }}
    >
      <Ionicons name={icon} size={10} color={color} />
      <RNText className="text-[9.5px] font-bold" style={{ color }}>
        {label}
      </RNText>
    </View>
  );
}

export interface ProductBadgePillsProps {
  product: ProductListItem;
  /** Placement — most callers position the stack over the photo, top-left. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The merchandising badge stack — New / Bestseller / Premium / Fresh / % OFF —
 * one component shared by the catalogue card, the quick-view sheet and the
 * product details screen, so a product wears the SAME pills wherever it is
 * opened (previously only the card had them).
 *
 * Rules inherited from the card: derivation is data-driven
 * (product-badges.ts), and an out-of-stock product wears no merchandising
 * badges at all. Renders nothing when no badge applies, so callers can place
 * it unconditionally.
 */
function ProductBadgePillsInner({ product, style }: ProductBadgePillsProps) {
  const badges = deriveBadges(product);
  const merchBadges = deriveMerchBadges(product);

  if (badges.isOutOfStock) return null;

  const hasAny =
    badges.isNew ||
    badges.isBestseller ||
    merchBadges.length > 0 ||
    badges.discountPercent != null;

  if (!hasAny) return null;

  return (
    <View
      style={[
        {
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 4,
          // style.pointerEvents, not the deprecated prop: the pills are a
          // passive overlay and taps must fall through to the card beneath.
          pointerEvents: 'none',
        },
        style,
      ]}
    >
      {badges.isNew ? <BadgePill icon="sparkles-outline" label="New" color={ADD_GREEN} /> : null}
      {badges.isBestseller ? <BadgePill icon="flame" label="Bestseller" color={RUST} /> : null}
      {merchBadges.includes('premium') ? <BadgePill icon="star" label="Premium" color={MUSTARD} /> : null}
      {merchBadges.includes('fresh') ? <BadgePill icon="leaf" label="Fresh" color={ADD_GREEN} /> : null}
      {badges.discountPercent != null ? (
        <BadgePill icon="pricetag" label={`${badges.discountPercent}% OFF`} color={MUSTARD} />
      ) : null}
    </View>
  );
}

export const ProductBadgePills = memo(ProductBadgePillsInner);
