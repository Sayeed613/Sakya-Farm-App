import { useReducedMotion } from 'react-native-reanimated';

/**
 * Reduced-motion helper that is safe on every Reanimated 4 setup: the hook
 * reads the OS accessibility setting, and components treat `true` as "skip
 * decorative movement". Kept in its own module so components import one name
 * regardless of underlying implementation changes.
 */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}
