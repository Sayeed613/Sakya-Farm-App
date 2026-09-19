import { Image } from 'expo-image';
import { useCallback, useRef, useState } from 'react';
import { Dimensions, FlatList, View, type ViewToken } from 'react-native';

import { AnimatedPressable, usePressScale } from '../../lib/motion';

const W = Dimensions.get('window').width - 32;
/** ~3:1 banner creatives; the artwork carries headline + CTA itself. */
const SLIDE_H = Math.round((W * 207) / 637);

export interface HeroCarouselProps {
  slides: Array<{
    key: string;
    image: import('react-native').ImageSourcePropType;
    accessibilityLabel: string;
    onPress: () => void;
  }>;
}

/**
 * Hero banner carousel: one designed banner per configured entry. The
 * supplied creatives (headline, supporting line, CTA) ARE the slide visuals,
 * so this renders the artwork alone at its native aspect ratio — no text
 * overlay, no derived product photos, no double messaging. Dot pagination.
 */
export function HeroCarousel({ slides }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewabilityRef = useRef({ viewAreaCoveragePercentThreshold: 60 });

  if (slides.length === 0) return null;

  return (
    <View className="gap-2">
      <FlatList
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        data={slides}
        keyExtractor={(slide) => slide.key}
        viewabilityConfig={viewabilityRef.current}
        onViewableItemsChanged={useCallback(
          ({ viewableItems }: { viewableItems: ViewToken[] }) => {
            const first = viewableItems[0]?.index;
            if (first != null) setActiveIndex(first);
          },
          [],
        )}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        decelerationRate="fast"
        snapToInterval={W + 12}
        renderItem={({ item }) => <HeroSlide slide={item} />}
      />
      {slides.length > 1 ? (
        <View className="flex-row items-center justify-center gap-1.5">
          {slides.map((slide, index) => (
            <View
              key={slide.key}
              className="h-1.5 rounded-full"
              style={{
                width: index === activeIndex ? 16 : 6,
                backgroundColor: index === activeIndex ? '#0B594C' : '#D2C4AE',
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HeroSlide({ slide }: { slide: HeroCarouselProps['slides'][number] }) {
  const press = usePressScale();

  return (
    <AnimatedPressable
      onPress={slide.onPress}
      accessibilityRole="button"
      accessibilityLabel={slide.accessibilityLabel}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className="overflow-hidden rounded-2xl"
    >
      <View style={{ width: W, height: SLIDE_H }}>
        <Image
          accessibilityRole="image"
          accessibilityLabel={slide.accessibilityLabel}
          source={slide.image}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          cachePolicy="disk"
          transition={180}
        />
      </View>
    </AnimatedPressable>
  );
}
