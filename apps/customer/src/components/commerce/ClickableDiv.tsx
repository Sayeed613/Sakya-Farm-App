import { Platform, View } from 'react-native';

import type { ViewProps } from 'react-native';

/**
 * Web-only clickable wrapper.
 *
 * React Native web renders `Pressable` as a `<button>` element, and a
 * Pressable nested inside another Pressable produces nested `<button>`s —
 * invalid HTML that throws a React hydration error on web. The workaround is
 * a clickable `div`: react-native-web only promotes a view to a `<button>`
 * when it carries `accessibilityRole="button"` (or is a Pressable), so this
 * wrapper deliberately omits that role.
 *
 * On native platforms the wrapper renders a plain View (it is only meant to
 * be used behind a `Platform.OS === 'web'` branch, where the caller's real
 * Pressable takes over).
 */

/**
 * View props minus accessibilityRole (it must never be "button" here, or
 * react-native-web renders the div as a <button> again), plus the web-only
 * click handler.
 */
type ClickableDivProps = Omit<ViewProps, 'children' | 'accessibilityRole'> & {
  children?: React.ReactNode;
  /** Click handler — only used on web. */
  onClick?: () => void;
};

/** True on web; native callers render their regular Pressable instead. */
export const IS_WEB = Platform.OS === 'web';

export function ClickableDiv({ children, onClick, ...rest }: ClickableDivProps) {
  if (Platform.OS !== 'web') {
    // Guard for direct native usage: plain, inert View.
    return <View {...(rest as ViewProps)}>{children}</View>;
  }
  const handleWebClick = (event: unknown) => {
    // Nested inside the card's outer <button>: stop the click from bubbling
    // up, or tapping ADD would also trigger the card's quick view.
    (event as { stopPropagation?: () => void })?.stopPropagation?.();
    onClick?.();
  };
  // RN's ViewProps has no `onClick` (it is react-native-web's DOM extension),
  // so the prop is attached through a cast — web-only component.
  const WebClickView = View as unknown as React.ComponentType<
    Omit<ViewProps, 'accessibilityRole'> & { onClick?: (event: unknown) => void }
  >;
  return (
    <WebClickView {...rest} onClick={handleWebClick}>
      {children}
    </WebClickView>
  );
}
