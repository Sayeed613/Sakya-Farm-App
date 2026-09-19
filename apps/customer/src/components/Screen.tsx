import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, layout } from '../theme';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap the content in a `ScrollView` with the standard horizontal padding. */
  scroll?: boolean;
  /** Apply the default horizontal padding. Off for full-bleed lists. */
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  refreshing?: boolean;
  /** Providing this adds pull-to-refresh to a scrolling screen. */
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The standard page shell: safe-area aware, warm canvas, optional scrolling.
 *
 * Safe-area insets are applied here rather than per screen so nothing sits under
 * a notch or a home indicator. Screens that need a virtualised list (the
 * catalogue) render their own list instead of using `scroll`, so the list keeps
 * its recycling behaviour.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'bottom'],
  refreshing = false,
  onRefresh,
  contentStyle,
  style,
  testID,
}: ScreenProps) {
  const content = [padded ? styles.padded : null, contentStyle];

  return (
    <SafeAreaView style={[styles.safeArea, style]} edges={edges} testID={testID}>
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          {...(onRefresh === undefined
            ? {}
            : {
                refreshControl: (
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    tintColor={colors.primary}
                    colors={[colors.primary]}
                  />
                ),
              })}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, content]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  fill: { flex: 1 },
  padded: {
    paddingHorizontal: layout.screenPaddingHorizontal,
  },
});
