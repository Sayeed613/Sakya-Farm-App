import { memo } from 'react';
import { FlatList } from 'react-native';

import { CategoryCollageTile } from '../commerce/CategoryCollageTile';
import { useResponsive } from '../../lib/responsive';
import type { DiscoveryTile } from '../../hooks/use-home-discovery';

/** Grid geometry: three columns, square wells, tight premium density. */
const TILE_GAP = 10;
export const DISCOVERY_GRID_COLUMNS = 3;

function DiscoveryGridInner({
  tiles,
  onPressTile,
}: {
  tiles: DiscoveryTile[];
  onPressTile: (tile: DiscoveryTile) => void;
}) {
  const { screenPadding, gridTileWidth } = useResponsive();

  return (
    <FlatList
      data={tiles}
      keyExtractor={(tile) => tile.handle}
      numColumns={DISCOVERY_GRID_COLUMNS}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: screenPadding,
        gap: 12,
      }}
      /* Partial last rows (2 or 1 tiles in 3 columns) sit CENTRED so the
       * grid reads balanced, never hugging one edge. */
      columnWrapperStyle={{ gap: TILE_GAP, justifyContent: 'center' }}
      renderItem={({ item }) => (
        <CategoryCollageTile
          name={item.name}
          count={item.count}
          imageUris={(item.images ?? []).map((image) =>
            typeof image === 'object' && image !== null && 'uri' in image
              ? String((image as { uri?: unknown }).uri ?? '')
              : '',
          )
            .filter((uri) => uri.length > 0)}
          width={gridTileWidth}
          onPress={() => onPressTile(item)}
        />
      )}
    />
  );
}

export const DiscoveryGrid = memo(DiscoveryGridInner);
