import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text as RNText, View } from 'react-native';

import { ClickableDiv, IS_WEB } from './ClickableDiv';

const BRAND = '#0C831F'; // Blinkit action green — matches ProductCard ADD

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
 * quantities change. The ADD state is OUTLINED (green border + green text
 * on the card's white surface) — the filled green arrives only when the
 * stepper (− 1 +) is active, so the state change reads instantly.
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
  const addControl = (
    <Pressable
      onPress={onAdd}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Add to cart"
      accessibilityState={{ disabled }}
      className={
        'h-8 items-center justify-center rounded-lg px-3' +
        (disabled ? ' opacity-40' : ' active:opacity-70')
      }
      style={{
        borderWidth: 1.5,
        borderColor: BRAND,
        backgroundColor: elevated ? '#FFFFFF' : 'transparent',
      }}
    >
      <RNText className="text-[12px] font-extrabold" style={{ color: BRAND }}>
        ADD
      </RNText>
    </Pressable>
  );

  if (quantity <= 0) {
    // Web note: this control renders inside the product card's outer
    // Pressable; a nested Pressable becomes a nested <button> on web, which
    // React flags as invalid HTML. A View with onClick stays clickable
    // without the nesting.
    return (
      <View style={{ width, height: 32 }}>
        {IS_WEB ? (
          <ClickableDiv
            // No accessibilityRole="button" — it would render the div as a
            // <button> on web again (nested-button hydration error).
            accessibilityLabel="Add to cart"
            onClick={onAdd}
            className={
              'h-8 cursor-pointer items-center justify-center rounded-lg px-3' +
              (disabled ? ' opacity-40' : '')
            }
            style={{
              borderWidth: 1.5,
              borderColor: BRAND,
              backgroundColor: elevated ? '#FFFFFF' : 'transparent',
            }}
          >
            <RNText className="text-[12px] font-extrabold" style={{ color: BRAND }}>
              ADD
            </RNText>
          </ClickableDiv>
        ) : (
          addControl
        )}
      </View>
    );
  }

  // Web note: like the ADD state above, −/+ render inside the product card's
  // outer <button>, so they must be clickable divs — Pressable with
  // accessibilityRole="button" would produce nested <button>s (React rejects
  // the markup and LogBox's error toast covers the card row).
  const stepButton = (onPress: () => void, label: string, icon: 'remove' | 'add') =>
    IS_WEB ? (
      <ClickableDiv
        accessibilityLabel={label}
        onClick={onPress}
        className="h-7 w-7 items-center justify-center cursor-pointer"
      >
        <Ionicons name={icon} size={16} color={BRAND} />
      </ClickableDiv>
    ) : (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        className="h-7 w-7 items-center justify-center"
      >
        <Ionicons name={icon} size={16} color={BRAND} />
      </Pressable>
    );

  return (
    <View
      style={{ width, height: 32, borderWidth: 1, borderColor: BRAND }}
      className={'flex-row items-center justify-between rounded-lg bg-white px-1' + (elevated ? ' shadow-sm' : '')}
    >
      {stepButton(onDecrement, 'Decrease quantity', 'remove')}
      <RNText className="min-w-[16px] text-center text-[13px] font-bold text-ink">{quantity}</RNText>
      {stepButton(onIncrement, 'Increase quantity', 'add')}
    </View>
  );
}
