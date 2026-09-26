import { Ionicons } from '@expo/vector-icons';
import { Text as RNText, View } from 'react-native';

/**
 * Offline banner — rendered by the root layout above the navigator when the
 * OS reports no network. Static by design: it is not a toast, it is state.
 * Disappears the moment connectivity returns (state-driven, no timers).
 */
export function OfflineBanner() {
  return (
    <View
      className="flex-row items-center justify-center gap-1.5 py-1.5"
      style={{ backgroundColor: '#B3453E' }}
      accessibilityRole="alert"
      accessibilityLabel="You are offline. Actions will resume when the connection returns."
    >
      <Ionicons name="cloud-offline" size={13} color="#FFFFFF" />
      <RNText className="text-[12px] font-semibold" style={{ color: '#FFFFFF' }}>
        You&apos;re offline — check your connection
      </RNText>
    </View>
  );
}
