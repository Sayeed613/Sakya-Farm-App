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

import { navBarVisibility } from '../../lib/nav-visibility';

/* ============================================================
   SAKYA DESIGN TOKENS
   ============================================================ */

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

const TAB_ORDER = [
  'index',
  'categories',
  'fresh',
  'orders',
  'profile',
];

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

  categories: {
    label: 'Categories',
    icon: 'grid-outline',
    activeIcon: 'grid',
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

/* ============================================================
   MAIN NAVBAR
   ============================================================ */

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

  /* ==========================================================
     HIDE ON SCROLL
     ========================================================== */

  const [hiddenByScroll, setHiddenByScroll] =
    useState(false);

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
  }, [
    hiddenByRoute,
    hiddenByScroll,
    hideProgress,
  ]);

  const floatingStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: hideProgress.value * 130,
      },
    ],

    opacity:
      1 - hideProgress.value * 0.45,
  }));

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

  const [rowWidth, setRowWidth] =
    useState(0);

  const tabWidth =
    tabs.length > 0
      ? rowWidth / tabs.length
      : 0;

  const activeIndex = Math.max(
    0,
    tabs.findIndex(
      (route) =>
        route.key === focusedRoute?.key,
    ),
  );

  const activeX = useSharedValue(0);

  const activeOpacity =
    useSharedValue(0);

  useEffect(() => {
    if (
      tabWidth <= 0 ||
      tabs.length === 0
    ) {
      return;
    }

    const nextX =
      activeIndex * tabWidth;

    activeX.value = withSpring(
      nextX,
      SPRING,
    );

    activeOpacity.value =
      withTiming(1, {
        duration: 180,
      });
  }, [
    activeIndex,
    tabWidth,
    tabs.length,
    activeX,
    activeOpacity,
  ]);

  const activePillStyle =
    useAnimatedStyle(() => ({
      transform: [
        {
          translateX: activeX.value,
        },
      ],

      opacity: activeOpacity.value,
    }));

  const onRowLayout = (
    event: LayoutChangeEvent,
  ) => {
    setRowWidth(
      event.nativeEvent.layout.width,
    );
  };

  if (hiddenByRoute) {
    return null;
  }

  /* ==========================================================
     RENDER
     ========================================================== */

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: 'absolute',

          left: 0,
          right: 0,
          bottom: 0,

          paddingHorizontal: 14,

          paddingBottom: Math.max(
            insets.bottom,
            10,
          ),
        },

        floatingStyle,
      ]}
    >
      {/* ======================================================
          OUTER FLOATING GLASS
          ====================================================== */}

      <View
        style={{
          borderRadius: 32,

          overflow: 'hidden',

          borderWidth: 1,

          borderColor:
            GLASS_BORDER,

          backgroundColor:
            GLASS_WHITE,

          shadowColor: BRAND_DARK,

          shadowOffset: {
            width: 0,
            height: 10,
          },

          shadowOpacity: 0.15,

          shadowRadius: 24,

          elevation: 14,
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
              position: 'relative',

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
                pointerEvents="none"
                style={[
                  {
                    position: 'absolute',

                    left: 0,

                    top: 1,
                    bottom: 1,

                    width: tabWidth,

                    borderRadius: 25,

                    backgroundColor:
                      ACTIVE_BG,

                    borderWidth: 1,

                    borderColor:
                      ACTIVE_BORDER,

                    shadowColor: BRAND,

                    shadowOffset: {
                      width: 0,
                      height: 3,
                    },

                    shadowOpacity: 0.10,

                    shadowRadius: 9,

                    elevation: 3,
                  },

                  activePillStyle,
                ]}
              />
            ) : null}

            {/* =================================================
                TABS
                ================================================= */}

            {tabs.map((route) => {
              const definition =
                TAB_DEFS[route.name];

              if (!definition) {
                return null;
              }

              const active =
                route.key ===
                focusedRoute?.key;

              const onPress = () => {
                if (!active) {
                  if (
                    Platform.OS !== 'web'
                  ) {
                    void Haptics.impactAsync(
                      Haptics.ImpactFeedbackStyle.Light,
                    );
                  }
                }

                const event =
                  navigation.emit({
                    type: 'tabPress',

                    target: route.key,

                    canPreventDefault: true,
                  });

                if (
                  !event?.defaultPrevented
                ) {
                  navigation.navigate(
                    route.name,
                  );
                }
              };

              return (
                <BottomTabButton
                  key={route.key}
                  label={
                    definition.label
                  }
                  icon={
                    active
                      ? definition.activeIcon ??
                        definition.icon
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
    </Animated.View>
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
  const iconScale =
    useSharedValue(
      active ? 1.08 : 1,
    );

  const iconY =
    useSharedValue(
      active ? -1 : 0,
    );

  const labelOpacity =
    useSharedValue(
      active ? 1 : 0.72,
    );

  const labelY =
    useSharedValue(
      active ? 0 : 1,
    );

  useEffect(() => {
    iconScale.value =
      withSpring(
        active ? 1.08 : 1,
        SPRING,
      );

    iconY.value =
      withSpring(
        active ? -1 : 0,
        SPRING,
      );

    labelOpacity.value =
      withTiming(
        active ? 1 : 0.72,
        {
          duration: 160,
        },
      );

    labelY.value =
      withTiming(
        active ? 0 : 1,
        {
          duration: 160,
        },
      );
  }, [
    active,
    iconScale,
    iconY,
    labelOpacity,
    labelY,
  ]);

  const iconStyle =
    useAnimatedStyle(() => ({
      transform: [
        {
          translateY: iconY.value,
        },

        {
          scale: iconScale.value,
        },
      ],
    }));

  const labelStyle =
    useAnimatedStyle(() => ({
      opacity:
        labelOpacity.value,

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

      <Animated.View
        style={iconStyle}
      >
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

            justifyContent:
              'center',
          },

          labelStyle,
        ]}
      >
        <RNText
          numberOfLines={1}
          style={{
            fontSize: 9.5,

            lineHeight: 12,

            fontWeight: active
              ? '800'
              : '600',

            color: active
              ? BRAND_DARK
              : INACTIVE,

            letterSpacing: 0.05,
          }}
        >
          {label}
        </RNText>
      </Animated.View>
    </Pressable>
  );
}

export const BottomTabBar =
  memo(BottomTabBarInner);