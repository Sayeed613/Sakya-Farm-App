import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { AnimatedPressable, usePressScale } from '../../lib/motion';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

export interface DropdownChipProps {
  /** Chip label, e.g. "Filters" or the active option ("In Stock"). */
  label: string;
  /** Prefix rendered before the label ("Sort", "Type", "Count"). */
  prefix?: string;
  /** Active state (a non-default option is selected). */
  active?: boolean;
  onPress: () => void;
}

/**
 * Toolbar chip for the Fresh listing (Filters / Sort / Type / Count row).
 *
 * A plain prefix + value in one pill; when no value is selected the prefix
 * stands alone. Chevron signals the dropdown affordance.
 */
function DropdownChipInner({ label, prefix, active = false, onPress }: DropdownChipProps) {
  const press = usePressScale();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={prefix ? `${prefix}: ${label}` : label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className={
        'flex-row items-center gap-1 rounded-full border px-3 py-1.5 ' +
        (active ? 'border-brand bg-brand/10' : 'border-line bg-white')
      }
    >
      {prefix ? (
        <RNText
          className={'text-[12px] ' + (active ? 'font-semibold' : 'font-medium')}
          style={{ color: active ? BRAND : MUTED }}
        >
          {prefix}
        </RNText>
      ) : null}
      <RNText
        className={'text-[12px] ' + (active ? 'font-bold' : 'font-semibold')}
        style={{ color: active ? BRAND : INK }}
      >
        {label}
      </RNText>
      <Ionicons name={active ? 'chevron-up' : 'chevron-down'} size={12} color={active ? BRAND : MUTED} />
    </AnimatedPressable>
  );
}

export const DropdownChip = memo(DropdownChipInner);

/** Simple bottom-sheet-style option menu rendered inline under the toolbar. */
export function ChipOptionMenu({
  options,
  onSelect,
  onDismiss,
}: {
  options: string[];
  onSelect: (option: string) => void;
  onDismiss: () => void;
}) {
  return (
    <View className="mx-4 mt-1.5 rounded-2xl border border-line bg-white px-1 py-1">
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onSelect(option)}
          accessibilityRole="button"
          accessibilityLabel={`Select ${option}`}
          className="flex-row items-center justify-between rounded-xl px-3 py-2.5 active:bg-surface-muted"
        >
          <RNText className="text-[13px] font-medium text-ink">{option}</RNText>
          <Ionicons name="chevron-forward" size={14} color={MUTED} />
        </Pressable>
      ))}
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close options"
        className="items-center rounded-xl py-1.5"
      >
        <RNText className="text-[11.5px] font-semibold" style={{ color: MUTED }}>
          Close
        </RNText>
      </Pressable>
    </View>
  );
}
