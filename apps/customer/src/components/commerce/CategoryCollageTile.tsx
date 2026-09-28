import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Text as RNText, View } from 'react-native';
import { AnimatedPressable, usePressScale } from '../../lib/motion';

const INK = '#171A18';
const INK_SOFT = '#68736E';
// Photo-well placeholder. Must match the app's WARM canvas family
// Matches the home page canvas exactly (#FBF7F0) so the discovery tiles read
// as cut-outs of the page, not cards of a different colour sitting on it.
// (An earlier value — cool grey #F1F2F4, then surfaceMuted #F3EDE3 — kept
// showing as a visibly different block on the warm canvas.)
const CANVAS = '#FBF7F0';
const CARD_RADIUS = 18;
// Tighter padding + gap → every photo well gets bigger (the "small images
// a bit big" fix) without changing the grid's 3-column geometry.
const CARD_PADDING = 6;
const INNER_GAP = 5;
const HERO_RADIUS = 12;
const STACK_RADIUS = 9;

export interface CategoryCollageTileProps {
  name: string;
  count: number;
  imageUris: string[];
  width: number;
  onPress: () => void;
}

/**
 * Category discovery tile — the premium collection-card pattern.
 *
 * One photo  → full-bleed hero (a single-product category shows its product,
 *              never a tiled fragment — same rule as the product cards).
 * 2+ photos  → large hero on the left, a stack of supporting shots on the
 *              right; the overflow lives as a quiet "+N" scrim chip pinned
 *              to the hero's corner — nothing floats outside the card.
 *
 * The name sits below with the real purchasable count, so the card informs
 * instead of decorating.
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

  // Hybrid geometry: hero takes ~58% of the inner width (down from 62% so
  // the supporting stack gets noticeably larger cells); the stack is two
  // cells filling the same height. With ≤1 photo the hero spans it all.
  const hasStack = imageUris.length >= 2;
  const heroWidth = hasStack ? Math.round(innerWidth * 0.58) : innerWidth;
  const stackWidth = hasStack ? innerWidth - heroWidth - INNER_GAP : 0;
  const stackCell = Math.floor((stackWidth - INNER_GAP) / 2);
  // Taller image block overall: the stack cells size the height, and with
  // the slimmer padding the whole photo area reads larger in the same grid.
  const imageBlockHeight = hasStack
    ? stackCell * 2 + INNER_GAP
    : Math.round(innerWidth * 0.82);

  const shownPhotos = hasStack ? 3 : 1;
  const overflowCount = Math.max(0, count - shownPhotos);

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
      {/* ── Image block: hero + optional stack ─────────────────────────── */}
      <View style={{ width: '100%', height: imageBlockHeight, flexDirection: 'row', gap: INNER_GAP }}>
        {/* Hero */}
        <View
          style={{
            width: heroWidth,
            height: imageBlockHeight,
            borderRadius: HERO_RADIUS,
            overflow: 'hidden',
            backgroundColor: CANVAS,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {imageUris.length > 0 ? (
            <Image
              source={{ uri: imageUris[0] }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={`${name}-hero`}
              transition={140}
            />
          ) : (
            <Ionicons name="leaf" size={20} color="rgba(11,89,76,0.35)" />
          )}

          {/* Overflow chip — pinned INSIDE the hero corner, never floating. */}
          {overflowCount > 0 ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                right: 5,
                bottom: 5,
                paddingHorizontal: 6,
                paddingVertical: 2.5,
                borderRadius: 999,
                backgroundColor: 'rgba(23,26,24,0.55)',
              }}
            >
              <RNText style={{ color: '#FFFFFF', fontSize: 9, lineHeight: 12, fontWeight: '700' }}>
                +{overflowCount}
              </RNText>
            </View>
          ) : null}
        </View>

        {/* Supporting stack */}
        {hasStack ? (
          <View style={{ width: stackWidth, height: imageBlockHeight, gap: INNER_GAP }}>
            {[1, 2].map((slot) => {
              const uri = imageUris[slot];
              return (
                <View
                  key={slot}
                  style={{
                    flex: 1,
                    borderRadius: STACK_RADIUS,
                    overflow: 'hidden',
                    backgroundColor: CANVAS,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={{ width: '100%', height: '100%' }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={`${name}-stack-${slot}`}
                      transition={140}
                    />
                  ) : (
                    <Ionicons name="leaf" size={14} color="rgba(11,89,76,0.30)" />
                  )}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      {/* ── Identity: name + real count ────────────────────────────────── */}
      <RNText
        style={{
          marginTop: 8,
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
