import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, spacing } from '../theme';
import { Text } from './Text';

export interface LoadingStateProps {
  /** Announced to assistive technology; also shown, so sighted users get context. */
  message?: string;
  testID?: string;
}

/**
 * Shown while a screen's data is in flight.
 *
 * Carries a live region so the state change is announced rather than silent — a
 * spinner alone tells a screen-reader user nothing.
 */
export function LoadingState({ message = 'Loading…', testID }: LoadingStateProps) {
  return (
    <View
      style={styles.root}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text variant="body" color={colors.textMuted} align="center">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xxxl,
  },
});
