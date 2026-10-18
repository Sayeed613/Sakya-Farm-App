import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

export interface InlineErrorBannerProps {
  /** Friendly text. Never pass a raw stack trace or provider payload. */
  message: string;
  /** Optional short heading; omitted in compact placements (inside cards). */
  title?: string;
  /** Providing this renders the shared retry button under the message. */
  onRetry?: () => void;
  testID?: string;
}

/**
 * Inline error banner — a failure renders INSIDE the screen's layout flow
 * instead of taking the screen over with a centred block: a bordered card
 * with an icon, the message and an optional retry.
 *
 * Every order-screen error goes through here so the copy, colour and retry
 * affordance stay identical across the list, the detail page and the cards.
 * Announces politely when it appears, the same contract ErrorState keeps.
 */
export function InlineErrorBanner({
  title,
  message,
  onRetry,
  testID,
}: InlineErrorBannerProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID={testID}
      style={styles.card}
    >
      <Ionicons
        name="alert-circle"
        size={18}
        color={colors.danger}
        style={styles.icon}
      />
      <View style={styles.content}>
        {title !== undefined ? (
          <Text variant="label" color={colors.danger}>
            {title}
          </Text>
        ) : null}
        <Text variant="caption" color={colors.textMuted}>
          {message}
        </Text>
        {onRetry !== undefined ? (
          <Button label="Try again" variant="secondary" onPress={onRetry} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    // Soft danger border: the checkout inline error uses the same pair, so a
    // payment failure and a load failure read as one language.
    borderColor: '#F0C9C4',
    backgroundColor: colors.dangerMuted,
  },
  icon: { marginTop: 1 },
  content: { flex: 1, gap: spacing.xs },
});
