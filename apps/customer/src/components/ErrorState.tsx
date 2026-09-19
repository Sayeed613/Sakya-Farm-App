import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

export interface ErrorStateProps {
  title?: string;
  /** Already-friendly text. Never pass a raw stack trace or provider payload. */
  message: string;
  /** Providing this renders a retry button. */
  onRetry?: () => void;
  /** Correlation id from the API, shown small so a support request can quote it. */
  requestId?: string | undefined;
  testID?: string;
}

/**
 * Shown when a request failed.
 *
 * Always offers a next step when one exists (retry), and surfaces the API's
 * `requestId` in small print — it maps to a log line, so a customer can quote it
 * without the app having to explain correlation ids.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  requestId,
  testID,
}: ErrorStateProps) {
  return (
    <View style={styles.root} testID={testID} accessibilityLiveRegion="polite">
      <View style={styles.card}>
        <Text variant="heading" color={colors.danger}>
          {title}
        </Text>
        <Text variant="body" color={colors.textMuted} align="center">
          {message}
        </Text>

        {requestId === undefined ? null : (
          <Text variant="caption" color={colors.textSubtle} align="center">
            Reference {requestId}
          </Text>
        )}

        {onRetry === undefined ? null : (
          <Button label="Try again" onPress={onRetry} variant="secondary" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  card: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.dangerMuted,
    alignSelf: 'stretch',
  },
});
