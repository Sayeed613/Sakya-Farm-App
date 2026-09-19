import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation } from '../../theme';

/**
 * The Sakya floating bottom navigation.
 *
 * A detached pill that floats above content on the warm canvas, holding the
 * static tabs: Home · Categories · Sakya Fresh · Orders · Account. Dynamic
 * detail routes (product/[slug], categories/[slug], search) have no entry in
 * TAB_DEFS and are excluded structurally.
 *
 * Screens can HIDE the bar entirely with `tabBarStyle: { display: 'none' }` in
 * their route options (the product screen does) — the focused route's
 * descriptors are checked here, so the bar unmounts on navigate and returns on
 * back, exactly like the built-in bar.
 */
export interface BottomTabBarProps {
  state: unknown;
  descriptors: unknown;
  navigation: unknown;
}

interface RouteShape {
  key: string;
  name: string;
}

type IconName =
  | 'home'
  | 'leaf'
  | 'grid-outline'
  | 'receipt-outline'
  | 'person-outline';

/** Display order of tabs, independent of file-system registration order. */
const TAB_ORDER = ['index', 'categories', 'fresh', 'orders', 'profile'];

const TAB_DEFS: Record<
  string,
  { label: string; icon: IconName }
> = {
  index: { label: 'Home', icon: 'home' },
  categories: { label: 'Categories', icon: 'grid-outline' },
  fresh: { label: 'Sakya Fresh', icon: 'leaf' },
  orders: { label: 'Orders', icon: 'receipt-outline' },
  profile: { label: 'Account', icon: 'person-outline' },
};

const BRAND = '#0B594C';
const MUTED = '#8C8A80';

function BottomTabBarInner(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const { state, navigation, descriptors } = props as {
    state: { routes: RouteShape[]; index: number };
    descriptors: Record<string, { options: { tabBarStyle?: { display?: string } } }>;
    navigation: {
      navigate: (screen: string) => void;
      emit: (event: {
        type: string;
        target?: string;
        canPreventDefault?: boolean;
      }) => { defaultPrevented?: boolean } | void;
    };
  };

  // Hide on screens that opted out (product detail). The bar is keyed by the
  // focused route, so navigating back restores it without a reload.
  const focused = state.routes[state.index];
  const focusedOptions = focused ? descriptors[focused.key]?.options : undefined;
  if (focusedOptions?.tabBarStyle?.display === 'none') return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: Math.max(insets.bottom, 10),
        paddingHorizontal: 20,
      }}
    >
      <View
        className="flex-row items-center justify-between rounded-[28px] border border-line bg-white px-2 py-1.5"
        style={elevation.bar}
      >
        {state.routes
          .slice()
          .sort(
            (a, b) =>
              (TAB_ORDER.indexOf(a.name) + 1 || TAB_ORDER.length + 1) -
              (TAB_ORDER.indexOf(b.name) + 1 || TAB_ORDER.length + 1),
          )
          .map((route) => {
          const def = TAB_DEFS[route.name];
          if (!def) return null; // dynamic detail routes get no tab

          const isFocused = route === state.routes[state.index];
          const color = isFocused ? BRAND : MUTED;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!event?.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={def.label}
              className="flex-1 items-center gap-0.5 rounded-2xl py-2"
            >
              <Ionicons name={def.icon} color={color} size={22} />
              <RNText className="text-[10px] font-semibold leading-3" style={{ color }}>
                {def.label}
              </RNText>
              <View
                className="mt-0.5 h-1 w-1 rounded-full"
                style={{ backgroundColor: isFocused ? BRAND : 'transparent' }}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const BottomTabBar = memo(BottomTabBarInner);
