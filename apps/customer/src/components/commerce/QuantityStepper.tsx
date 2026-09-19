import { Ionicons } from '@expo/vector-icons';
import { Text as RNText, Pressable, View } from 'react-native';

const BRAND = '#0B594C';

export interface QuantityStepperProps {
  /** Current quantity; 0 renders the ADD pill. */
  quantity: number;
  /** Called when ADD is pressed (first add). */
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
  /** Width of both states, so the swap does not shift the card layout. */
  width?: number;
  /** White backing for controls floating over imagery (grid cards). */
  elevated?: boolean;
}

/**
 * The ADD → − 1 + control.
 *
 * Both states occupy the same fixed-size frame, so the swap is a cross-fade
 * rather than a layout jump; the card grid stays perfectly still while
 * quantities change. AnimatedContainer-based morphing stays available to
 * callers that want it — here the fixed frame is what guarantees no jump.
 */
export function QuantityStepper({
  quantity,
  onAdd,
  onIncrement,
  onDecrement,
  disabled = false,
  width = 88,
  elevated = false,
}: QuantityStepperProps) {
  if (quantity <= 0) {
    return (
      <View style={{ width, height: 32 }}>
        <Pressable
          onPress={onAdd}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Add to cart"
          accessibilityState={{ disabled }}
          className={
            'h-8 items-center justify-center rounded-lg border border-brand px-3' +
            (elevated ? ' bg-white' : '') +
            (disabled ? ' opacity-40' : ' active:bg-brand-muted')
          }
        >
          <RNText className="text-[12px] font-bold uppercase tracking-wide text-brand">Add</RNText>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{ width, height: 32 }}
      className={
        'flex-row items-center justify-between rounded-lg border border-brand bg-white px-1' +
        (elevated ? ' shadow-sm' : '')
      }
    >
      <Pressable
        onPress={onDecrement}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        hitSlop={8}
        className="h-7 w-7 items-center justify-center"
      >
        <Ionicons name="remove" size={16} color={BRAND} />
      </Pressable>
      <RNText className="min-w-[16px] text-center text-[13px] font-bold text-ink">{quantity}</RNText>
      <Pressable
        onPress={onIncrement}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        hitSlop={8}
        className="h-7 w-7 items-center justify-center"
      >
        <Ionicons name="add" size={16} color={BRAND} />
      </Pressable>
    </View>
  );
}
