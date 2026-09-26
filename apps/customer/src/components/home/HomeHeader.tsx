import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headerCollapse } from '../../lib/header-collapse';
import { useAuthStore } from '../../stores/auth-store';
import { useDeliveryLocation } from '../../hooks/use-delivery-location';
import { useLastAddressStore } from '../../stores/last-address-store';
import { AddressPickerSheet } from '../checkout/AddressPickerSheet';
import { AddressSheet } from '../checkout/AddressSheet';

/* ============================================================
   SAKYA DESIGN TOKENS — same glass recipe as the bottom navbar
   ============================================================ */

const BRAND = '#0B594C';
const BRAND_DARK = '#073F36';
const INK = '#1D2119';
const ACCENT = '#F8CB46'; // brand yellow — cart badge only

/** Bottom-navbar glass: translucent white over a light blur. */
const GLASS_WHITE = 'rgba(255,255,255,0.78)';
const GLASS_BORDER = 'rgba(11,89,76,0.10)';

const CART_BG = 'rgba(11,89,76,0.10)';
const CART_BORDER = 'rgba(11,89,76,0.12)';

/**
 * The logo asset has transparent padding baked in (left pad = 4.3% of width,
 * top 31/887, right 72/1774, bottom 52/887 — measured from the PNG alpha).
 * The header row is left-aligned, so the VISIBLE mark must align with the
 * address text below it: negative margins cancel the transparent gutter.
 */
const LOGO_WIDTH = 120;
const LOGO_HEIGHT = 60; // 1774:887 ≈ 2:1
const LOGO_LEFT_TRIM = Math.round(-0.043 * LOGO_WIDTH); // ≈ -4
const LOGO_TOP_TRIM = Math.round(-(31 / 887) * LOGO_HEIGHT); // ≈ -2
const LOGO_BOTTOM_TRIM = Math.round(-(52 / 887) * LOGO_HEIGHT); // ≈ -3

export interface HomeHeaderProps {
  /** Where the location affordance navigates; hook only until a real flow exists. */
  onLocationPress?: () => void;
  /** Search placeholder shown in the in-band search pill. */
  searchPlaceholder?: string;
  /** Opens the search route from the in-band search pill. */
  onSearchPress?: () => void;
  /** Live cart item count for the band's cart badge (0/undefined = no badge). */
  cartCount?: number;
  /**
   * Rendered INSIDE the glass band — the fixed borderless category strip
   * lives here so the whole block is one fixed header, per the sketch.
   */
  children?: ReactNode;
  /**
   * Reports the band's measured height (status bar inset included) so the
   * screen can space its first content exactly — no guessed clearance, no
   * dead gap between the band and the hero.
   */
  onHeightChange?: (height: number) => void;
}

/**
 * Home header — a true glass OVERLAY: it floats above the scroll content and
 * the content scrolls BENEATH it, so the BlurView actually frosts real pixels
 * (a header placed above a list frosts nothing and reads flat — that's the
 * difference from the bottom navbar, which is also an overlay).
 *
 * Anatomy (expanded):
 *   ┌──────────────────────────────────────────────┐
 *   │ [sakya farms logo]                           │ ┐
 *   │ DELIVERY TO                                  │ │ collapses on scroll
 *   │ ⌖ street, city ▾                             │ ┘
 *   │ ┌──────────────────────┐ ┌────┐              │
 *   │ │ 🔍 Search "ghee"… 🎤 │ │ 🛒 │              │ ← fixed core
 *   │ └──────────────────────┘ └────┘              │
 *   │   [⬚][⬚][⬚][⬚][⬚]→  (category strip)        │ ← fixed core
 *   └──────────────────────────────────────────────┘
 *
 * The header is absolutely positioned over the screen; the home FlatList
 * runs edge-to-edge UNDERNEATH it. Scrolling down collapses the brand block
 * (logo + address) so only search + cart + strip stay fixed at the top.
 */
export function HomeHeader({
  onLocationPress,
  searchPlaceholder = 'Search "ghee"…',
  onSearchPress,
  cartCount = 0,
  children,
  onHeightChange,
}: HomeHeaderProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const collapse = useRef(new Animated.Value(0)).current; // 0 expanded · 1 collapsed
  const insets = useSafeAreaInsets();
  const location = useDeliveryLocation();
  const session = useAuthStore((state) => state.session);

  // Location affordance: the caller can override it, but with no handler the
  // address row must NOT be a dead control — it opens the same picker/editor
  // pair the cart and checkout use, writing to the shared last-address store.
  const lastAddress = useLastAddressStore((state) => state.address);
  const rememberAddress = useLastAddressStore((state) => state.remember);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const contactDefaults = useMemo(
    () =>
      session
        ? {
            name: [session.user.firstName, session.user.lastName].filter(Boolean).join(' '),
            phone: session.user.phone ?? '',
          }
        : null,
    [session],
  );

  function handleLocationPress() {
    if (onLocationPress !== undefined) {
      onLocationPress();
      return;
    }
    if (session !== null) {
      setPickerOpen(true);
      return;
    }
    setEditorOpen(true);
  }

  // Scroll collapse: the home list publishes intent on the shared bus; this
  // header subscribes. Reset to expanded on mount so a remount mid-list never
  // shows a collapsed band while the scroll offset is actually at the top.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    headerCollapse.set(false);
    setCollapsed(false);
    return headerCollapse.subscribe((next) => setCollapsed(next));
  }, []);

  useEffect(() => {
    Animated.timing(collapse, {
      toValue: collapsed ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // height is layout — JS driver required
    }).start();
  }, [collapsed, collapse]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  // Natural height of the collapsible brand block, measured on layout, so the
  // height animation is exact across fonts and dynamic type sizes.
  const [metaHeight, setMetaHeight] = useState(0);

  return (
    /* box-none: the glass pane itself must NEVER capture touches — drags
       that start on the band belong to the list underneath, otherwise
       flicking up while the finger is on the header kills the scroll
       (the "stuck" bug). Only the real controls below intercept. */
    <View pointerEvents="box-none" style={styles.overlay}>
      {/* Glass pane: content scrolls beneath it, so the blur has real pixels
          to frost (same as the bottom navbar). box-none keeps the pane itself
          touch-transparent; only the controls below capture. */}
      <View
        pointerEvents="box-none"
        style={[styles.glassWrap, { paddingTop: insets.top + 8 }]}
        onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      >
        <BlurView
          intensity={78}
          tint="light"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Brand texture: the header-bg artwork fills the band from the top
            down to the search row, then a white→clear LEFT→RIGHT gradient
            melts it into the white glass so the right side stays calm for
            the cart control. Height tracks the collapsible brand block, so
            the texture shrinks away with it on scroll. pointerEvents="none"
            keeps the pane touch-transparent (the stuck-scroll rule). */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              height: collapse.interpolate({
                inputRange: [0, 1],
                outputRange: [insets.top + 8 + (metaHeight || 118) + 6, insets.top + 8],
              }),
              overflow: 'hidden',
            },
          ]}
        >
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('../../images/header-bg.png')}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory"
          />
          {/* White at the left edge → fully clear to the right. */}
          <LinearGradient
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            colors={['rgba(255,255,255,0.96)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* Soft bottom feather so the artwork dissolves into the glass
              instead of ending in a hard seam above the search pill. */}
          <LinearGradient
            start={{ x: 0, y: 1 }}
            end={{ x: 0, y: 0.72 }}
            colors={['rgba(255,255,255,0.9)', 'rgba(255,255,255,0)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </Animated.View>

        {/* px-4 wrapper: also box-none so taps between/around controls fall
            through to the list. */}
        <View pointerEvents="box-none" className="px-4 pb-2.5">
          {/* ── Collapsible brand block: logo + delivery address ────────── */}
          <Animated.View
            style={{
              height: collapse.interpolate({
                inputRange: [0, 1],
                outputRange: [metaHeight || 118, 0],
              }),
              opacity: collapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              overflow: 'hidden',
            }}
          >
            <View onLayout={(event) => setMetaHeight(event.nativeEvent.layout.height)}>
              {/* Row 1: the real Sakya Farms logo mark (tinted brand green —
                  the asset is a white template, same as the auth screen).
                  Negative margins trim the asset's baked-in transparent
                  gutter so the VISIBLE mark aligns with the address text. */}
              <Image
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                source={require('../../images/sakya-logo-white.png')}
                style={{
                  width: LOGO_WIDTH,
                  height: LOGO_HEIGHT,
                  marginLeft: LOGO_LEFT_TRIM,
                  marginTop: LOGO_TOP_TRIM,
                  marginBottom: LOGO_BOTTOM_TRIM,
                  tintColor: BRAND,
                }}
                contentFit="contain"
                cachePolicy="memory"
                accessibilityLabel="Sakya Farms"
              />

              {/* Row 2: Delivery to + address — tappable, opens the picker.
                  Aligned to the same px-4 edge as the logo's visible ink. */}
              <Pressable
                onPress={handleLocationPress}
                accessibilityRole="button"
                accessibilityLabel="Change delivery location"
                className="mt-1"
              >
                <RNText
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: 'rgba(11,89,76,0.62)' }}
                >
                  Delivery to
                </RNText>
                <View className="mt-0.5 flex-row items-center">
                  <Ionicons name="location" size={13} color={BRAND} />
                  <RNText
                    className="ml-1 max-w-[270px] text-[13px] font-bold leading-[18px]"
                    style={{ color: INK }}
                    numberOfLines={1}
                  >
                    {location.status === 'locating' ? 'Locating…' : location.label}
                  </RNText>
                  <Ionicons name="chevron-down" size={13} color={BRAND} />
                </View>
              </Pressable>
            </View>
          </Animated.View>

          {/* ── Fixed core: green search pill + cart (never collapses) ──── */}
          <View className="mt-2 flex-row items-center gap-2.5">
            {onSearchPress ? (
              <Pressable
                onPress={onSearchPress}
                accessibilityRole="button"
                accessibilityLabel={searchPlaceholder}
                className="h-11 flex-1 flex-row items-center gap-2.5 rounded-2xl px-3.5"
                style={{ backgroundColor: BRAND }}
              >
                <Ionicons name="search" size={18} color="#FFFFFF" />
                <RNText
                  className="flex-1 text-[13.5px]"
                  style={{ color: 'rgba(255,255,255,0.92)' }}
                  numberOfLines={1}
                >
                  {searchPlaceholder}
                </RNText>
                <Ionicons name="mic-outline" size={17} color="rgba(255,255,255,0.85)" />
              </Pressable>
            ) : (
              <View className="flex-1" />
            )}

            <Pressable
              onPress={() => router.push('/(shop)/cart')}
              accessibilityRole="button"
              accessibilityLabel={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center rounded-2xl"
              style={{ backgroundColor: CART_BG, borderWidth: 1, borderColor: CART_BORDER }}
            >
              <Ionicons name="cart-outline" size={21} color={BRAND} />
              {cartCount > 0 ? (
                <View
                  className="absolute -top-1.5 -right-1.5 h-[18px] min-w-[18px] items-center justify-center rounded-full px-1"
                  style={{ backgroundColor: ACCENT }}
                >
                  <RNText className="text-[10px] font-extrabold" style={{ color: BRAND_DARK }}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </RNText>
                </View>
              ) : null}
            </Pressable>
          </View>

          {/* ── Fixed category strip (caller-supplied), glass-mode tiles sit
              flush with the band's own px-4 — no double inset. */}
          {children}
        </View>
      </View>

      {/* Location sheets — identical flows to cart/checkout; the chosen
          address lands in the shared last-address store. */}
      <AddressPickerSheet
        visible={pickerOpen}
        selected={lastAddress}
        onClose={() => setPickerOpen(false)}
        onConfirm={(address) => {
          rememberAddress(address);
          setPickerOpen(false);
        }}
        onEdit={() => {
          setPickerOpen(false);
          setEditorOpen(true);
        }}
        onAddNew={() => {
          setPickerOpen(false);
          setEditorOpen(true);
        }}
      />
      <AddressSheet
        visible={editorOpen}
        initial={lastAddress}
        contactDefaults={contactDefaults}
        canSaveToBook={session !== null}
        onClose={() => setEditorOpen(false)}
        onSave={(address) => {
          rememberAddress(address);
          setEditorOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    // Overlay pins to the top only; height is content-driven, so the list
    // scrolls beneath the band and the blur has real pixels to frost.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
  },
  glassWrap: {
    backgroundColor: GLASS_WHITE,
    // Hairline green edge so the glass pane reads as a pane, not a wash.
    borderBottomColor: GLASS_BORDER,
    borderBottomWidth: StyleSheet.hairlineWidth,
    // Deliberately LIGHT shadow — a heavy drop under a fixed glass band
    // reads as a slab; the blur + hairline carry the separation.
    shadowColor: BRAND_DARK,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});
