import type { ReactNode } from 'react';
import {
  StyleSheet,
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { colors, typography } from '../theme';

export type TextVariant = keyof typeof typography;

export interface TextProps extends Omit<RNTextProps, 'style'> {
  children: ReactNode;
  variant?: TextVariant;
  /** Any value from `colors`. Defaults to the brand's warm near-black. */
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Upper-cased with tracking. Used for section eyebrows, not for body copy. */
  uppercase?: boolean;
  style?: StyleProp<TextStyle>;
}

/**
 * Every string in the app goes through here.
 *
 * Centralising it means one place decides line height and weight, so headings
 * cannot drift apart screen by screen. `allowFontScaling` is left at its default
 * (on), so the layout respects the OS text-size setting.
 */
export function Text({
  children,
  variant = 'body',
  color,
  align,
  uppercase = false,
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        styles[variant],
        // Explicit default rather than React Native's platform black, so brand
        // copy is the same warm near-black on both platforms.
        { color: color ?? colors.text },
        align === undefined ? null : { textAlign: align },
        uppercase ? styles.uppercase : null,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  ...typography,
  uppercase: { textTransform: 'uppercase', letterSpacing: 0.8 },
} satisfies Record<TextVariant | 'uppercase', TextStyle>);
