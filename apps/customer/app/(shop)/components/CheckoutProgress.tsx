import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';

const SUBTLE = '#8C8A80';
/** Completed steps + savings figures. Deliberately lighter than BRAND. */
const GREEN = '#1F7A43';

/**
 * PROGRESS — Address → Delivery → Payment → Review
 *
 * Every state is real screen state: done = green check, current = green
 * number, future = muted outline. The connector behind completed steps turns
 * green so the sequence reads at a glance over the artwork.
 */
export default function CheckoutProgress({
  steps,
}: {
  steps: readonly { label: string; state: 'done' | 'current' | 'future' }[];
}) {
  return (
    <View className="flex-row items-start px-4 pt-2.5" style={{ pointerEvents: 'none' }}>
      {steps.map((step, index) => (
        <Fragment key={step.label}>
          {index > 0 ? (
            <View
              style={[
                styles.progressLine,
                steps[index - 1]?.state === 'done' ? styles.progressLineDone : null,
              ]}
            />
          ) : null}

          <View style={styles.progressStep}>
            <View
              style={[
                styles.progressDot,
                step.state === 'done' ? styles.progressDotDone : null,
                step.state === 'current' ? styles.progressDotCurrent : null,
                step.state === 'future' ? styles.progressDotFuture : null,
              ]}
            >
              {step.state === 'done' ? (
                <Ionicons name="checkmark" size={13} color="#FFFFFF" />
              ) : (
                <RNText
                  style={[
                    styles.progressIndex,
                    step.state === 'current' ? styles.progressIndexCurrent : null,
                  ]}
                >
                  {index + 1}
                </RNText>
              )}
            </View>

            <RNText
              style={[
                styles.progressLabel,
                step.state === 'future' ? styles.progressLabelFuture : null,
              ]}
            >
              {step.label}
            </RNText>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  progressLine: {
    // Sits on the dot's centre line: the step column is dot + label tall.
    alignSelf: 'flex-start',
    backgroundColor: '#D9DED6',
    flex: 1,
    height: 1.5,
    marginTop: 10,
  },

  progressLineDone: {
    backgroundColor: 'rgba(31, 122, 67, 0.5)',
  },

  progressStep: {
    alignItems: 'center',
    width: 62,
  },

  progressDot: {
    alignItems: 'center',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },

  progressDotDone: {
    backgroundColor: GREEN,
  },

  progressDotCurrent: {
    backgroundColor: GREEN,
  },

  progressDotFuture: {
    backgroundColor: '#FFFFFF',
    borderColor: '#C6CEC3',
    borderWidth: 1.5,
  },

  progressIndex: {
    color: SUBTLE,
    fontSize: 10.5,
    fontWeight: '800',
  },

  progressIndexCurrent: {
    color: '#FFFFFF',
  },

  progressLabel: {
    color: '#2F3830',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 5,
  },

  progressLabelFuture: {
    color: SUBTLE,
  },
});
