import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, spacing, touchTarget } from '../theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks presses, while keeping the label readable. */
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One button component for the app.
 *
 * Accessibility is part of the component rather than the caller's job: it always
 * exposes `role="button"`, reports `disabled`/`busy` to assistive technology, and
 * meets the 48pt minimum touch target so nothing in the app is fiddly to hit.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const isInactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isInactive}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isInactive ? styles[`${variant}Pressed`] : null,
        isInactive ? styles.inactive : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'primary' ? colors.textInverse : colors.primary}
          />
        ) : null}
        <Text
          variant="label"
          color={labelColorFor(variant)}
          style={loading ? styles.labelWithSpinner : undefined}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function labelColorFor(variant: ButtonVariant): string {
  return variant === 'primary' ? colors.textInverse : colors.primary;
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  labelWithSpinner: { marginLeft: spacing.xs },
  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  secondaryPressed: { backgroundColor: colors.primaryMuted },
  ghost: { backgroundColor: 'transparent' },
  ghostPressed: { backgroundColor: colors.surfaceMuted },
  /** Opacity rather than a grey fill, so the label stays legible on any background. */
  inactive: { opacity: 0.55 },
});
