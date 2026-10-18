import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';

import { memo, useEffect, useMemo, useState } from 'react';

import {
  Platform,
  Pressable,
  Text as RNText,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';

import { navBarVisibility } from '../../lib/nav-visibility';

/** The bottom nav bar used to float above the content on every screen.

 * Because it is `position: absolute` inside an Animated root, it "hangs" a
 * pixel or two above the safe-area bottom on some OS/viewport combos, and
 * anything scrolled to the very bottom (orders, profile, account details)
 * slides under it and another screen's content covers the last tab button —
 * a tap on the visible tab then opens the wrong screen. The bar is now an
 * in-flow view (`position: relative`, no safe-area offset), so it pushes
 * content down instead of floating over it, and the bottom edge can never
 * be shaved by a rendering bug.

 * The bar must NOT set `flex: 1`. The navigator lays the scene and this bar
 * out as two siblings in a column: the scene already carries `flex: 1`, so a
 * second `flex: 1` here split the viewport in half — the home screen was
 * squeezed into the top ~50% and everything below the bar was empty
 * navigator-background grey. Sizing to content (`alignSelf: 'stretch'` only)
 * hands the whole remainder back to the scene while keeping the bar in flow.
 */

const BRAND = '#0B594C';
const BRAND_DARK = '#073F36';

const INACTIVE = '#68736E';

const GLASS_WHITE = 'rgba(255,255,255,0.78)';
const GLASS_BORDER = 'rgba(255,255,255,0.95)';

const ACTIVE_BG = 'rgba(255,255,255,0.94)';
const ACTIVE_BORDER = 'rgba(11,89,76,0.12)';

const SPRING = {
  damping: 18,
  stiffness: 240,
  mass: 0.85,
};

/** The four bar tabs: Home | Fresh | Orders | Account.

 * `categories` is intentionally absent — its route still exists (reachable
 * from Home's "View all" and the footer's "Shop All"), but it is NOT a bar
 * button. Any route missing from TAB_DEFS is filtered out of the row below.
 */
const TAB_ORDER = ['index', 'fresh', 'orders', 'profile'];

const TAB_DEFS: Record<
  string,
  {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    activeIcon?: keyof typeof Ionicons.glyphMap;
  }
> = {
  index: {
    label: 'Home',
    icon: 'home-outline',
    activeIcon: 'home',
  },

  fresh: {
    label: 'Fresh',
    icon: 'leaf-outline',
    activeIcon: 'leaf',
  },

  orders: {
    label: 'Orders',
    icon: 'receipt-outline',
    activeIcon: 'receipt',
  },

  profile: {
    label: 'Account',
    icon: 'person-outline',
    activeIcon: 'person',
  },
};

export interface BottomTabBarProps {
  state: unknown;
  descriptors: unknown;
  navigation: unknown;
}

interface RouteShape {
  key: string;
  name: string;
}

/* ==========================================================
   MAIN NAVBAR
   ========================================================== */

function BottomTabBarInner(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const { state, navigation, descriptors } = props as {
    state: {
      routes: RouteShape[];
      index: number;
    };

    descriptors: Record<
      string,
      {
        options: {
          tabBarStyle?: {
            display?: string;
          };
        };
      }
    >;

    navigation: {
      navigate: (screen: string) => void;

      emit: (event: {
        type: string;
        target?: string;
        canPreventDefault?: boolean;
      }) =>
        | {
            defaultPrevented?: boolean;
          }
        | void;
    };
  };

  const focusedRoute = state.routes[state.index];

  const focusedOptions = focusedRoute
    ? descriptors[focusedRoute.key]?.options
    : undefined;

  const hiddenByRoute =
    focusedOptions?.tabBarStyle?.display === 'none';

  if (hiddenByRoute) {
    return null;
  }

  /* ==========================================================
     HIDE ON SCROLL
     ========================================================== */

  const [hiddenByScroll, setHiddenByScroll] = useState(false);

  useEffect(() => {
    return navBarVisibility.subscribe((visible) => {
      setHiddenByScroll(!visible);
    });
  }, []);

  const hideProgress = useSharedValue(0);

  useEffect(() => {
    hideProgress.value = withTiming(
      hiddenByRoute || hiddenByScroll ? 1 : 0,
      {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      },
    );
  }, [hiddenByRoute, hiddenByScroll, hideProgress]);

  /* ==========================================================
     TABS
     ========================================================== */

  const tabs = useMemo(
    () =>
      state.routes
        .slice()
        .sort(
          (a, b) =>
            (TAB_ORDER.indexOf(a.name) + 1 ||
              TAB_ORDER.length + 1) -
            (TAB_ORDER.indexOf(b.name) + 1 ||
              TAB_ORDER.length + 1),
        )
        .filter(
          (route) =>
            TAB_DEFS[route.name] != null,
        ),
    [state.routes],
  );

  /* ==========================================================
     ACTIVE TAB GEOMETRY

     IMPORTANT:
     We measure the ACTUAL TAB ROW.
     Therefore the active capsule uses the exact same
     geometry as the buttons.

     No fixed 64px nonsense.
     ========================================================== */

  const [rowWidth, setRowWidth] = useState(0);

  const tabWidth =
    tabs.length > 0
      ? rowWidth / tabs.length
      : 0;

  // -1 when the focused route is not a bar tab (e.g. the categories screen,
  // which is a real route but has no button) — handled below so the capsule
  // fades out instead of sticking to the first tab.
  const activeIndex = tabs.findIndex(
    (route) =>
      route.key === focusedRoute?.key,
  );

  const activeX = useSharedValue(0);

  const activeOpacity = useSharedValue(0);

  useEffect(() => {
    if (tabWidth <= 0 || tabs.length === 0) {
      return;
    }

    if (activeIndex < 0) {
      activeOpacity.value = withTiming(0, {
        duration: 180,
      });
      return;
    }

    const nextX = activeIndex * tabWidth;

    activeX.value = withSpring(nextX, SPRING);

    activeOpacity.value = withTiming(1, {
      duration: 180,
    });
  }, [activeIndex, tabWidth, tabs.length, activeX, activeOpacity]);

  const activePillStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: activeX.value,
      },
    ],

    opacity: activeOpacity.value,
  }));

  const onRowLayout = (event: LayoutChangeEvent) => {
    setRowWidth(event.nativeEvent.layout.width);
  };

  if (hiddenByRoute) {
    return null;
  }

  /* ==========================================================
     RENDER
     ========================================================== */

  return (
    <View
      style={{
        // Stretch across the row but hug the bar's own height vertically.
        // No `flex: 1` — see the note above.
        alignSelf: 'stretch',

        position: 'relative',

        paddingBottom: Math.max(insets.bottom, 10),
      }}
    >
      {/* ======================================================
          BAR
          ====================================================== */}

      <View
        style={{
          borderRadius: 32,

          overflow: 'hidden',

          borderWidth: 1,

          borderColor: GLASS_BORDER,

          backgroundColor: GLASS_WHITE,

          boxShadow: '0 10px 24px rgba(11, 63, 54, 0.15)',
        }}
      >
        <BlurView
          intensity={78}
          tint="light"
          style={{
            paddingHorizontal: 6,
            paddingVertical: 6,
          }}
        >
          {/* ==================================================
              NAV ROW

              The measurement happens HERE.
              So active pill and buttons always line up.
              ================================================== */}

          <View
            onLayout={onRowLayout}
            style={{
              flexDirection: 'row',

              alignItems: 'center',

              minHeight: 64,
            }}
          >
            {/* =================================================
                ACTIVE GLASS CAPSULE
                ================================================= */}

            {tabWidth > 0 ? (
              <Animated.View
                style={[
                  {
                    position: 'absolute',

                    left: 0,

                    top: 1,
                    bottom: 1,

                    width: tabWidth,

                    borderRadius: 25,

                    backgroundColor: ACTIVE_BG,

                    borderWidth: 1,

                    borderColor: ACTIVE_BORDER,

                    boxShadow: '0 3px 9px rgba(11, 89, 76, 0.10)',

                    // The sliding capsule is decoration behind the real tab
                    // buttons — it must never swallow a tap.
                    pointerEvents: 'none',
                  },

                  activePillStyle,
                ]}
              />
            ) : null}

            {/* =================================================
                TABS
                ================================================= */}

            {tabs.map((route) => {
              const definition = TAB_DEFS[route.name];

              if (!definition) {
                return null;
              }

              const active = route.key === focusedRoute?.key;

              const onPress = () => {
                if (!active) {
                  if (Platform.OS !== 'web') {
                    void Haptics.impactAsync(
                      Haptics.ImpactFeedbackStyle.Light,
                    );
                  }
                }

                const event = navigation.emit({
                  type: 'tabPress',

                  target: route.key,

                  canPreventDefault: true,
                });

                if (!event?.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              return (
                <BottomTabButton
                  key={route.key}
                  label={definition.label}
                  icon={
                    active
                      ? definition.activeIcon ?? definition.icon
                      : definition.icon
                  }
                  active={active}
                  onPress={onPress}
                />
              );
            })}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

/* ============================================================
   TAB BUTTON
   ============================================================ */

function BottomTabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;

  icon: keyof typeof Ionicons.glyphMap;

  active: boolean;

  onPress: () => void;
}) {
  const iconScale = useSharedValue(active ? 1.08 : 1);

  const iconY = useSharedValue(active ? -1 : 0);

  const labelOpacity = useSharedValue(active ? 1 : 0.72);

  const labelY = useSharedValue(active ? 0 : 1);

  useEffect(() => {
    iconScale.value = withSpring(active ? 1.08 : 1, SPRING);

    iconY.value = withSpring(active ? -1 : 0, SPRING);

    labelOpacity.value = withTiming(
      active ? 1 : 0.72,
      {
        duration: 160,
      },
    );

    labelY.value = withTiming(
      active ? 0 : 1,
      {
        duration: 160,
      },
    );
  }, [active, iconScale, iconY, labelOpacity, labelY]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: iconY.value,
      },

      {
        scale: iconScale.value,
      },
    ],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,

    transform: [
      {
        translateY: labelY.value,
      },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{
        selected: active,
      }}
      accessibilityLabel={label}
      style={{
        flex: 1,

        minHeight: 62,

        alignItems: 'center',

        justifyContent: 'center',

        paddingVertical: 7,

        zIndex: 2,
      }}
    >
      {/* ICON */}

      <Animated.View style={iconStyle}>
        <Ionicons
          name={icon}
          size={22}
          color={
            active
              ? BRAND
              : INACTIVE
          }
        />
      </Animated.View>

      {/* LABEL */}

      <Animated.View
        style={[
          {
            marginTop: 3,

            height: 13,

            alignItems: 'center',

            justifyContent: 'center',
          },

          labelStyle,
        ]}
      >
        <RNText
          numberOfLines={1}
          style={{
            fontSize: 9.5,

            lineHeight: 12,

            fontWeight: active ? '800' : '600',

            color: active ? BRAND_DARK : INACTIVE,

            letterSpacing: 0.05,
          }}
        >
          {label}
        </RNText>
      </Animated.View>
    </Pressable>
  );
}

/** Scroll-clearance hook for the bottom nav bar.

 * The bar is in-flow now, but on a real mobile viewport it still needs to
 * push the content down while the user is scrolled to the very bottom, so
 * the tab row can never clip or occlude the last content row or the active
 * tab button. This hook keeps that behaviour in the bar instead of spreading
 * it across every screen, and it only runs when the viewport is a
 * phone-sized mobile window (the sim ships the same 390x844 device frame
 * everywhere).
 */
export function useScrollClearanceForBottomTabBar() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [isAtBottom, setIsAtBottom] = useState(false);

  // On web the nearest scrollable root is document.documentElement. The
  // scroll listener tracks the BODY (not the bar), so it keeps working once
  // the bar moves out of the way.
  useEffect(() => {
    const root = document.documentElement ?? null;
    if (!root) return;
    const clearance = windowHeight - insets.bottom - 64;
    const onScroll = () => {
      setIsAtBottom(root.scrollHeight - root.scrollTop <= clearance + 2);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, [insets.bottom, windowHeight]);

  // The bar is ~64px tall plus the safe-area bottom padding. If the nearest
  // scroll view's scrollHeight is within a couple of pixels of the viewport
  // height minus that padding, the bar would overlap the last row of
  // content. Push it down while the user is there so the tab row never
  // clips it.
  if (window.innerWidth <= 480 && window.innerHeight <= 720 && isAtBottom) {
    return (
      <View
        style={{
          flex: 1,

          width: '100%',

          minHeight: Math.max(64 + insets.bottom, 64),
        }}
      />
    );
  }
  return null;
}

export const BottomTabBar = memo(BottomTabBarInner);
