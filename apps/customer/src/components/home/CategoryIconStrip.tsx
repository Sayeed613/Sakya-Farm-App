import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';

import type { CategorySummary } from '@sakya/types';
import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from '../../config/category-icons';
import { getCategoryImage } from '../../config/category-images';
import { AnimatedPressable, usePressScale } from '../../lib/motion';

const INK = '#1D2119';
const TILE = 56;
const GAP = 14;

/** Unified Sakya icon green — every glyph in the strip uses this. */
const ICON_GREEN = '#08493B';

/** Active capsule — the bottom navbar's active-tab recipe. */
const ACTIVE_BG = 'rgba(255,255,255,0.94)';
const ACTIVE_BORDER = 'rgba(11,89,76,0.12)';

/** Glass mode (strip inside the fixed header): smaller frosted tiles. */
const GLASS_TILE = 44;
const GLASS_ICON = 20;
/** Frosted-white tile bg — glassmorphism on the header glass, no border. */
const GLASS_TILE_BG = 'rgba(255,255,255,0.55)';

export interface CategoryIconStripProps {
  categories: CategorySummary[];
  onPress: (category: CategorySummary) => void;
  /** Present = prepend the Blinkit-style "All" tile that opens the directory. */
  onPressAll?: () => void;
  /** Two scrollable rows (Blinkit) or one. */
  rows?: 1 | 2;
  /**
   * Pre-selected tile slug (controlled, optional) — pairs with the local
   * sticky selection; a controlled value wins only while nothing was tapped.
   */
  activeSlug?: string | null;
  /**
   * Glass mode — strip renders inside the fixed green header band: tiles
   * lose their borders and card look so they sit directly on the glass.
   */
  onGlass?: boolean;
}

const BRAND_DARK_TEXT = '#073F36';

/** One quick icon: glyph tile + label, tappable through to the category. */
function CategoryIcon({
  category,
  onPress,
  onGlass,
  active,
}: {
  category: CategorySummary;
  onPress: CategoryIconStripProps['onPress'];
  onGlass: boolean;
  active: boolean;
}) {
  const press = usePressScale();
  const image = getCategoryImage(category.slug);
  const icon = (CATEGORY_ICONS[category.slug] ?? FALLBACK_CATEGORY_ICON) as keyof typeof Ionicons.glyphMap;
  const tile = onGlass ? GLASS_TILE : TILE;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${category.name}, ${category.productCount} products`}
      onPress={() => onPress(category)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="items-center gap-1"
    >
      <View
        className={
          onGlass
            ? "items-center justify-center overflow-hidden rounded-xl"
            : "items-center justify-center overflow-hidden rounded-xl border border-line bg-white"
        }
        style={
          active
            ? // Active = the navbar's white capsule with the green hairline.
              {
                width: tile,
                height: tile,
                backgroundColor: ACTIVE_BG,
                borderWidth: 1,
                borderColor: ACTIVE_BORDER,
              }
            : onGlass
              ? { width: tile, height: tile, backgroundColor: GLASS_TILE_BG }
              : { width: tile, height: tile }
        }
      >
        {image ? (
          <Image
            source={image}
            style={{ width: onGlass ? tile - 8 : '100%', height: onGlass ? tile - 8 : '100%' }}
            contentFit="contain"
            cachePolicy="memory"
            recyclingKey={category.slug}
            transition={100}
          />
        ) : (
          <Ionicons name={icon} size={onGlass ? GLASS_ICON : 24} color={ICON_GREEN} />
        )}
      </View>
      <RNText
        className="w-[68px] text-center text-[10.5px] font-semibold leading-3.5"
        style={
          active
            ? { color: ICON_GREEN, fontWeight: '800' }
            : { color: onGlass ? BRAND_DARK_TEXT : INK }
        }
        numberOfLines={1}
      >
        {category.name}
      </RNText>
    </AnimatedPressable>
  );
}

/** The circular "All" entry tile that leads the strip. */
function AllTile({
  onPress,
  onGlass,
  active,
}: {
  onPress?: () => void;
  onGlass: boolean;
  active: boolean;
}) {
  const press = usePressScale();
  const tile = onGlass ? GLASS_TILE : TILE;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel="All categories"
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="items-center gap-1"
    >
      <View
        className={
          onGlass
            ? "items-center justify-center rounded-xl"
            : "items-center justify-center rounded-xl border border-line bg-white"
        }
        style={
          active
            ? {
                width: tile,
                height: tile,
                backgroundColor: ACTIVE_BG,
                borderWidth: 1,
                borderColor: ACTIVE_BORDER,
              }
            : onGlass
              ? { width: tile, height: tile, backgroundColor: GLASS_TILE_BG }
              : { width: tile, height: tile }
        }
      >
        <Ionicons name="grid" size={onGlass ? GLASS_ICON : 22} color={ICON_GREEN} />
      </View>
      <RNText
        className="w-[68px] text-center text-[10.5px] font-semibold"
        style={
          active
            ? { color: ICON_GREEN, fontWeight: '800' }
            : { color: onGlass ? BRAND_DARK_TEXT : INK }
        }
      >
        All
      </RNText>
    </AnimatedPressable>
  );
}

/**
 * The Blinkit quick-category pattern: a horizontally scrolling strip with TWO
 * rows of tiles, led by the "All" tile that opens the categories directory.
 * The top row reads the first half of the categories, the bottom row the rest.
 * Counts are small (≤ 24), so a ScrollView beats FlatList gymnastics here.
 */
function CategoryIconStripInner({
  categories,
  onPress,
  onPressAll,
  rows = 2,
  onGlass = false,
  activeSlug,
}: CategoryIconStripProps) {
  // Active state — the bottom navbar's pattern: the tapped tile wears the
  // white capsule until another tile is chosen. Sticky across renders (and
  // scroll re-entries on the home list) so the selection doesn't vanish.
  const [selected, setSelected] = useState<string | null>(null);

  function handlePress(category: CategorySummary) {
    setSelected(category.slug);
    onPress(category);
    // The tile highlights for a beat, then relaxes to rest state — the
    // destination is a separate screen; leaving a phantom "active" tab on
    // home would read as a broken navbar.
    setTimeout(() => setSelected(null), 600);
  }

  if (rows === 1) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          // Glass mode renders inside the header's own px-4 — no extra edge
          // padding, or the strip drifts in from the screen edge.
          paddingHorizontal: onGlass ? 0 : 16,
          gap: onGlass ? 10 : GAP,
          paddingTop: onGlass ? 8 : 0,
        }}
      >
        {onPressAll ? (
          <AllTile onPress={onPressAll} onGlass={onGlass} active={selected === '__all__'} />
        ) : null}
        {categories.map((category) => (
          <CategoryIcon
            key={category.slug}
            category={category}
            onPress={handlePress}
            onGlass={onGlass}
            active={selected === category.slug || selected === null && activeSlug === category.slug}
          />
        ))}
      </ScrollView>
    );
  }

  const half = Math.ceil(categories.length / 2);
  const top = categories.slice(0, half);
  const bottom = categories.slice(half);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <View className="flex-row" style={{ gap: GAP }}>
          {onPressAll ? (
            <AllTile onPress={onPressAll} onGlass={onGlass} active={selected === '__all__'} />
          ) : null}
          {top.map((category) => (
            <CategoryIcon
              key={category.slug}
              category={category}
              onPress={handlePress}
              onGlass={onGlass}
              active={selected === category.slug || selected === null && activeSlug === category.slug}
            />
          ))}
        </View>
        <View className="flex-row" style={{ gap: GAP }}>
          {bottom.map((category) => (
            <CategoryIcon
              key={category.slug}
              category={category}
              onPress={handlePress}
              onGlass={onGlass}
              active={selected === category.slug || selected === null && activeSlug === category.slug}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

export const CategoryIconStrip = memo(CategoryIconStripInner);
