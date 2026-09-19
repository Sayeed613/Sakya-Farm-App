import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import type { CatalogVariant } from '@sakya/types';
import { formatMoney } from '../../lib/format';
import { variantSelectorLabelOf } from '../../lib/variant-units';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

export interface ProductVariantSelectorProps {
  variants: CatalogVariant[];
  /** The currently selected variant (controlled). */
  selected: CatalogVariant | null;
  onSelect: (variant: CatalogVariant) => void;
  /** Show each option's price next to its title (detail page). */
  showPrices?: boolean;
  /** Chip size: detail page uses large, sheets compact. */
  size?: 'compact' | 'large';
}

/**
 * The unit-aware variant selector.
 *
 * The heading is derived from the variants' own titles ("Select weight" for
 * g/kg, "Select volume" for ml/L, "Select quantity" for pcs, "Select pack" for
 * packs/boxes) — and every chip renders the backend title VERBATIM. The
 * component never converts, reformats or invents units: "500 g" can only ever
 * display as "500 g".
 *
 * Unavailable variants render disabled and cannot be selected. Products whose
 * variants differ in kind (e.g. a mixed pc + kg set) still show all of them —
 * units are never a reason to hide a variant.
 */
function ProductVariantSelectorInner({
  variants,
  selected,
  onSelect,
  showPrices = false,
  size = 'large',
}: ProductVariantSelectorProps) {
  if (variants.length === 0) return null;
  const label = variantSelectorLabelOf(variants) ?? 'Select option';
  const chipPadding = size === 'large' ? 'px-4 py-2' : 'px-3 py-1.5';
  const chipText = size === 'large' ? 'text-[13.5px]' : 'text-[12.5px]';

  return (
    <View className="gap-2">
      <RNText className="text-[12px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </RNText>
      <View className="flex-row flex-wrap gap-2">
        {variants.map((variant) => {
          const active = selected?.id === variant.id;
          const disabled = !variant.isAvailable;
          return (
            <Pressable
              key={variant.id}
              onPress={() => {
                if (!disabled) onSelect(variant);
              }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`${variant.title}${variant.isAvailable ? '' : ', unavailable'}`}
              className={
                'rounded-xl border ' + chipPadding +
                (active
                  ? ' border-brand bg-brand/10'
                  : disabled
                    ? ' border-line bg-surface-muted opacity-50'
                    : ' border-line bg-white')
              }
            >
              <View className="flex-row items-center gap-1.5">
                <RNText
                  className={chipText + ' font-bold'}
                  style={{ color: disabled ? MUTED : active ? BRAND : INK }}
                >
                  {variant.title}
                </RNText>
                {disabled ? <Ionicons name="close-circle" size={12} color={MUTED} /> : null}
                {showPrices && variant.isAvailable ? (
                  <RNText className="text-[11.5px] font-semibold" style={{ color: MUTED }}>
                    · {formatMoney(variant.priceInPaise)}
                  </RNText>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const ProductVariantSelector = memo(ProductVariantSelectorInner);
