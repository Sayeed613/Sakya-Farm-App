import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, radii, spacing, touchTarget } from '../theme';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /** Always rendered: a placeholder alone disappears as soon as typing starts. */
  label: string;
  /** Validation message. When set, the field is outlined and the message announced. */
  error?: string | null;
  /** Guidance shown under the field when there is no error. */
  hint?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A labelled text field.
 *
 * The error is rendered in a live region so a screen reader announces it when it
 * appears, and it is also passed as the field's `accessibilityHint` — screen
 * readers focus the input, not the message, so relying on the live region alone
 * would leave the user on a field that silently turned red.
 */
export function Input({
  label,
  error = null,
  hint = null,
  style,
  testID,
  ...rest
}: InputProps) {
  const hasError = error !== null && error !== '';

  return (
    <View style={[styles.root, style]}>
      <Text variant="label" color={colors.textMuted}>
        {label}
      </Text>

      <TextInput
        {...rest}
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={hasError ? error : undefined}
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={colors.textSubtle}
        style={[styles.field, hasError ? styles.fieldInvalid : null]}
      />

      {hasError ? (
        <Text variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint === null ? null : (
        <Text variant="caption" color={colors.textSubtle}>
          {hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  field: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  fieldInvalid: { borderColor: colors.danger },
});
