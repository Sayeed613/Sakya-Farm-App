import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { cardShadow } from '../../lib/shadows';

/*
 * ProductMediaCard — the redesigned product imagery.
 *
 * Design rules (deliberate, not arbitrary):
 *
 * 1. ONE photo  → the full image, uncropped (`contain`). A single-product
 *    pack shot (ghee jar, honey bottle) is shown whole — never sliced into
 *    a fake 2x2 collage of itself.
 *
 * 2. TWO+ photos → a tile GRID of *distinct* photos with visible gaps and
 *    rounded tile corners: 2 → side-by-side, 3 → wide hero + 2, 4 → 2x2,
 *    5+ → 2x2 with a "+N" overlay on the last tile.
 *
 * 3. The whole grid sits inside one white card: rounded background, hairline
 *    border and a soft elevation shadow (tokens in lib/shadows.ts).
 *
 * Anatomy:
 *
 *   ┌──────────────────────────┐ ← white card, radius 20, soft shadow
 *   │  ┌────────┐  ┌────────┐  │
 *   │  │        │  │        │  │ ← tiles, radius 14, gap 8
 *   │  └────────┘  └────────┘  │
 *   └──────────────────────────┘
 */

const TILE_RADIUS = 14;
const CARD_RADIUS = 20;
const GRID_GAP = 8;
const CARD_PADDING = 8;

const NEUTRAL_BG = '#F3EDE3';
const MUTED = '#8C8A80';

export interface ProductMediaCardProps {
  /** Image URLs in display order (already position-sorted). */
  urls: string[];
  /** Alt text used for accessibility on every tile. */
  accessibilityLabel?: string;
  /** Called when any tile is tapped. */
  onPress?: () => void;
  /** Constrain the card height (used inside fixed-height sheets). */
  height?: number;
}

export function ProductMediaCardInner({
  urls,
  accessibilityLabel = 'Product image',
  onPress,
  height,
}: ProductMediaCardProps) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // Drop URLs that failed to load so the grid re-flows instead of showing
  // broken wells. Memo keeps this stable across re-renders.
  const live = useMemo(
    () => urls.filter((url) => !failed[url]),
    [urls, failed],
  );

  const count = live.length;

  return (
    <View
      accessibilityRole={onPress ? 'imagebutton' : 'image'}
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          borderRadius: CARD_RADIUS,
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#ECE8E0',
          padding: CARD_PADDING,
          overflow: 'hidden',
        },
        cardShadow,
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        className="w-full"
        style={height != null ? { height } : undefined}
      >
        {count === 0 ? (
          <View
            className="items-center justify-center gap-1"
            style={{ aspectRatio: 1 }}
          >
            <Ionicons name="leaf-outline" size={30} color={MUTED} />
            <RNText className="text-[11px]" style={{ color: MUTED }}>
              Sakya Farms
            </RNText>
          </View>
        ) : count === 1 ? (
          /* ── SINGLE PHOTO: show the whole image, uncropped ── */
          <View
            className="w-full items-center justify-center"
            style={{ backgroundColor: NEUTRAL_BG, borderRadius: TILE_RADIUS, overflow: 'hidden' }}
          >
            <Image
              source={{ uri: live[0] ?? '' }}
              style={{ width: '100%', aspectRatio: 1 }}
              contentFit="contain"
              cachePolicy="disk"
              recyclingKey={live[0]}
              transition={150}
              onError={() =>
                setFailed((prev) => ({ ...prev, [live[0] ?? '']: true }))
              }
            />
          </View>
        ) : (
          /* ── MULTIPLE PHOTOS: gap-spaced rounded tile grid ── */
          <GridTiles urls={live} accessibilityLabel={accessibilityLabel} />
        )}
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Tile grid layouts                                                  */
/* ------------------------------------------------------------------ */

function GridTiles({
  urls,
  accessibilityLabel,
}: {
  urls: string[];
  accessibilityLabel: string;
}) {
  const count = urls.length;

  if (count === 2) {
    return (
      <View className="flex-row" style={{ gap: GRID_GAP }}>
        <Tile url={urls[0] ?? ''} accessibilityLabel={accessibilityLabel} />
        <Tile url={urls[1] ?? ''} accessibilityLabel={accessibilityLabel} />
      </View>
    );
  }

  if (count === 3) {
    // Wide hero tile on top, two below — balanced, editorial.
    return (
      <View style={{ gap: GRID_GAP }}>
        <Tile url={urls[0] ?? ''} accessibilityLabel={accessibilityLabel} ratio={2.05} />
        <View className="flex-row" style={{ gap: GRID_GAP }}>
          <Tile url={urls[1] ?? ''} accessibilityLabel={accessibilityLabel} />
          <Tile url={urls[2] ?? ''} accessibilityLabel={accessibilityLabel} />
        </View>
      </View>
    );
  }

  // 4+ → 2x2 grid. The 4th tile carries a "+N" overlay for the overflow.
  const overflow = count - 4;
  const tiles = urls.slice(0, 4);

  return (
    <View style={{ gap: GRID_GAP }}>
      <View className="flex-row" style={{ gap: GRID_GAP }}>
        <Tile url={tiles[0] ?? ''} accessibilityLabel={accessibilityLabel} />
        <Tile url={tiles[1] ?? ''} accessibilityLabel={accessibilityLabel} />
      </View>
      <View className="flex-row" style={{ gap: GRID_GAP }}>
        <Tile url={tiles[2] ?? ''} accessibilityLabel={accessibilityLabel} />
        <Tile
          url={tiles[3] ?? ''}
          accessibilityLabel={accessibilityLabel}
          overlay={overflow > 0 ? `+${overflow}` : undefined}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  One tile                                                           */
/* ------------------------------------------------------------------ */

function Tile({
  url,
  ratio,
  overlay,
  accessibilityLabel,
}: {
  url: string;
  ratio?: number;
  overlay?: string;
  accessibilityLabel: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      className="flex-1 items-center justify-center"
      style={{
        aspectRatio: ratio ?? 1,
        borderRadius: TILE_RADIUS,
        overflow: 'hidden',
        backgroundColor: NEUTRAL_BG,
      }}
    >
      {!failed ? (
        <Image
          source={{ uri: url }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="disk"
          recyclingKey={url}
          transition={150}
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons name="leaf-outline" size={22} color={MUTED} />
      )}

      {overlay ? (
        <View
          className="absolute inset-0 items-center justify-center"
          style={{ backgroundColor: 'rgba(23,26,24,0.45)' }}
        >
          <RNText className="text-[19px] font-extrabold" style={{ color: '#FFFFFF' }}>
            {overlay}
          </RNText>
        </View>
      ) : null}
    </View>
  );
}

export const ProductMediaCard = memo(ProductMediaCardInner);
