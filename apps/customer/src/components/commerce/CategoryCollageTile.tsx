import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, type ReactNode } from 'react';
import { Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import { AnimatedPressable, usePressScale } from '../../lib/motion';

const INK = '#171A18';
const INK_SOFT = '#68736E';
// Photo-well placeholder. Must match the app's WARM canvas family
// Matches the home page canvas exactly (#FBF7F0) so the discovery tiles read
// as cut-outs of the page, not cards of a different colour sitting on it.
const CANVAS = '#FBF7F0';
const CARD_RADIUS = 16;
const CARD_PADDING = 7;
const CELL_RADIUS = 10;
const GAP = 4;
/**
 * Photo-well height as a fraction of the tile's inner width — THE SAME for
 * every tile. The old geometry sized the well from the photo-lAYOUT (≈42% of
 * width for stacked collages vs 82% for single-photo cards), so a row mixed
 * the two and every shorter card stretched to the tallest one — the trail of
 * dead white space under the labels. Width-driven + uniform → every card in
 * the grid is the exact same height, row after row.
 */
const IMAGE_RATIO = 0.9;

export interface CategoryCollageTileProps {
  name: string;
  count: number;
  imageUris: string[];
  width: number;
  onPress: () => void;
}

/**
 * Category discovery tile — the compact quick-commerce collection card
 * (Blinkit-style, matched to the reference design).
 *
 * Photo well (uniform height on every tile):
 *   1 photo  → full-bleed hero — a single-product category shows its product
 *              whole, never a tiled fragment.
 *   2 photos → two equal portrait cells side by side.
 *   3 photos → hero + a right-hand column of two cells.
 *   4+ photos→ a 2×2 cluster; the same four cells carry the category's look.
 *
 * Name sits directly under the well with the real purchasable count — snug,
 * one line, no decorative padding. Because the well height never depends on
 * the photo count, cards in a row (and across rows) share one silhouette.
 */
function CategoryCollageTileInner({
  name,
  count,
  imageUris,
  width,
  onPress,
}: CategoryCollageTileProps) {
  const press = usePressScale();

  const innerWidth = width - CARD_PADDING * 2;
  const imageHeight = Math.round(innerWidth * IMAGE_RATIO);

  // Only real, non-empty URIs participate in the layout; the count line is
  // data-driven and never inferred from the photos present.
  const photos = imageUris.filter((uri) => uri.length > 0).slice(0, 4);

  const cell = (style: StyleProp<ViewStyle>, uri: string | undefined, key: string, iconSize: number) => (
    <View key={key} style={[{ borderRadius: CELL_RADIUS, overflow: 'hidden', backgroundColor: CANVAS, alignItems: 'center', justifyContent: 'center' }, style]}>
      {uri !== undefined ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${name}-${key}`}
          transition={140}
        />
      ) : (
        <Ionicons name="leaf" size={iconSize} color="rgba(11,89,76,0.32)" />
      )}
    </View>
  );

  let layout: ReactNode;
  if (photos.length >= 4) {
    // 2×2 cluster — the reference card's silhouette.
    const cellW = Math.floor((innerWidth - GAP) / 2);
    const cellH = Math.floor((imageHeight - GAP) / 2);
    layout = (
      <View style={{ width: innerWidth, height: imageHeight, flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        {photos.map((uri, index) => cell({ width: cellW, height: cellH }, uri, `q${index}`, 16))}
      </View>
    );
  } else if (photos.length === 3) {
    const heroW = Math.round((innerWidth - GAP) * 0.58);
    const rightW = innerWidth - GAP - heroW;
    const rightCellH = Math.floor((imageHeight - GAP) / 2);
    layout = (
      <View style={{ width: innerWidth, height: imageHeight, flexDirection: 'row', gap: GAP }}>
        {cell({ width: heroW, height: imageHeight }, photos[0], 'hero', 20)}
        <View style={{ width: rightW, height: imageHeight, gap: GAP }}>
          {cell({ width: rightW, height: rightCellH }, photos[1], 'r0', 14)}
          {cell({ width: rightW, height: rightCellH }, photos[2], 'r1', 14)}
        </View>
      </View>
    );
  } else if (photos.length === 2) {
    const cellW = Math.floor((innerWidth - GAP) / 2);
    layout = (
      <View style={{ width: innerWidth, height: imageHeight, flexDirection: 'row', gap: GAP }}>
        {cell({ width: cellW, height: imageHeight }, photos[0], 'l', 18)}
        {cell({ width: cellW, height: imageHeight }, photos[1], 'r', 18)}
      </View>
    );
  } else {
    // Single photo (or none): full-bleed well.
    layout = cell({ width: innerWidth, height: imageHeight }, photos[0], 'full', 22);
  }

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${count} products`}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        press.animatedStyle,
        {
          width,
          backgroundColor: '#FFFFFF',
          borderRadius: CARD_RADIUS,
          padding: CARD_PADDING,
          borderWidth: 1,
          borderColor: 'rgba(11,89,76,0.08)',
        },
      ]}
    >
      {/* ── Photo well — uniform height on every tile ─────────────────── */}
      {layout}

      {/* ── Identity: name + real count, snug under the well ──────────── */}
      <RNText
        style={{
          marginTop: 7,
          paddingHorizontal: 2,
          color: INK,
          fontSize: 12.5,
          lineHeight: 16,
          fontWeight: '700',
        }}
        numberOfLines={1}
      >
        {name}
      </RNText>
      <RNText
        style={{
          marginTop: 1,
          paddingHorizontal: 2,
          paddingBottom: 2,
          color: INK_SOFT,
          fontSize: 10.5,
          lineHeight: 14,
          fontWeight: '500',
        }}
        numberOfLines={1}
      >
        {count} {count === 1 ? 'product' : 'products'}
      </RNText>
    </AnimatedPressable>
  );
}

export const CategoryCollageTile = memo(CategoryCollageTileInner);
