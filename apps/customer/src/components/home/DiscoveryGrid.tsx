import { memo } from 'react';
import { FlatList, View } from 'react-native';

import { CategoryCollageTile } from '../commerce/CategoryCollageTile';
import { useResponsive } from '../../lib/responsive';
import type { DiscoveryTile } from '../../hooks/use-home-discovery';

/** Grid geometry: three columns, square wells, tight premium density. */
const TILE_GAP = 10;
/** Row rhythm — same tight spacing as the categories grid. */
const ROW_GAP = 10;
export const DISCOVERY_GRID_COLUMNS = 3;

/**
 * WHERE THE SPACING LIVES — and why it is not `contentContainerStyle`.
 *
 * This grid renders inside Home's vertical FlatList. A nested
 * same-orientation VirtualizedList does NOT get a ScrollView: React Native's
 * `_defaultRenderScrollComponent` returns a plain `<View {...props}/>` for
 * it, and a View silently drops `contentContainerStyle` — which is why the
 * grid used to render with zero padding (hugging the left edge, every bit of
 * slack piled on the right) and rows touching each other. So:
 *   - side padding → the list's own `style` (marginHorizontal, applied to
 *     the container View);
 *   - row gap → a per-item bottom margin (final row excluded, so the grid
 *     never grows a phantom gap above the next section).
 */
function DiscoveryGridInner({
  tiles,
  onPressTile,
}: {
  tiles: DiscoveryTile[];
  onPressTile: (tile: DiscoveryTile) => void;
}) {
  const { screenPadding, gridTileWidth } = useResponsive();
  const lastRowIndex = Math.floor(Math.max(tiles.length - 1, 0) / DISCOVERY_GRID_COLUMNS);

  return (
    <FlatList
      data={tiles}
      keyExtractor={(tile) => tile.handle}
      numColumns={DISCOVERY_GRID_COLUMNS}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      style={{ marginHorizontal: screenPadding }}
      /* Every row starts at the LEFT edge — a partial last row (1–2 tiles)
       * flows on from column one instead of floating centred. */
      columnWrapperStyle={{ gap: TILE_GAP, justifyContent: 'flex-start' }}
      renderItem={({ item, index }) => (
        <View
          style={{
            marginBottom: Math.floor(index / DISCOVERY_GRID_COLUMNS) < lastRowIndex ? ROW_GAP : 0,
          }}
        >
          <CategoryCollageTile
            name={item.name}
            count={item.count}
            imageUris={(item.images ?? []).map((image) =>
              typeof image === 'object' && image !== null && 'uri' in image
                ? String((image as { uri?: unknown }).uri ?? '')
                : '',
            ).filter((uri) => uri.length > 0)}
            width={gridTileWidth}
            onPress={() => onPressTile(item)}
          />
        </View>
      )}
    />
  );
}

export const DiscoveryGrid = memo(DiscoveryGridInner);
