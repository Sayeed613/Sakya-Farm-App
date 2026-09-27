import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View, type ViewToken } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useResponsive } from '../../lib/responsive';

/** ~3:1 banner creatives; the artwork carries headline + CTA itself. */
export const BANNER_W = 637;
export const BANNER_H = 207;
/** Slide gap; snap interval = slide + gap. */
const GAP = 12;
/** Auto-advance cadence (ms). */
const AUTO_MS = 3600;
/** The next slide peeks this many px on the right edge (Zepto promo rail). */
export const PEEK = 14;

export interface HeroCarouselProps {
  slides: Array<{
    key: string;
    image: import('react-native').ImageSourcePropType;
    accessibilityLabel: string;
    onPress: () => void;
  }>;
}

/**
 * Hero promo carousel, quick-commerce anatomy:
 *
 *  ┌───────────────────────────────┬─────┐
 *  │   promo creative (3:1)        │ ▌   │  ← next slide peeks
 *  │  (artwork IS the message)     │     │
 *  └───────────────────────────────┴─────┘
 *              ● ○ ○ ○ ○ ○                 ← pill/expand dots
 *
 * Auto-advances every ~3.6s, pauses while the finger is down (and for a
 * beat after releasing, so a tap doesn't skip), snaps on a fast clip, and
 * the active dot expands Zepto-style. Artwork IS the slide: headline, CTA
 * and product storytelling live in the creative — no overlay text, no
 * double messaging.
 */
function HeroCarouselInner({ slides }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const viewabilityRef = useRef({ viewAreaCoveragePercentThreshold: 60 });
  // Live viewport, NOT Dimensions at module load (froze first device width —
  // slides misaligned on other phones and in resized browsers).
  const { contentWidth, screenPadding } = useResponsive();
  const slideW = contentWidth - screenPadding * 2 - PEEK;
  const slideH = Math.round((slideW * BANNER_H) / BANNER_W);

  const listRef = useRef<FlatList>(null);
  const [paused, setPaused] = useState(false);
  const resumeAtRef = useRef(0);

  const goTo = useCallback(
    (index: number) => {
      const target = ((index % slides.length) + slides.length) % slides.length;
      listRef.current?.scrollToIndex({ index: target, animated: true });
    },
    [slides.length],
  );

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]?.index;
      if (first != null) setActiveIndex(first);
    },
    [],
  );

  // Auto-advance: skip entirely while the finger is down or within the
  // post-release grace window — a manual swipe must never fight the timer.
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(() => {
      if (Date.now() < resumeAtRef.current) return;
      goTo(activeIndex + 1);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [paused, activeIndex, goTo, slides.length]);

  function beginInteraction() {
    setPaused(true);
  }

  function endInteraction() {
    // Grace window after release: taps/swipes settle before auto resumes.
    resumeAtRef.current = Date.now() + 900;
    setPaused(false);
  }

  if (slides.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      <FlatList
        ref={listRef}
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        data={slides}
        keyExtractor={(slide) => slide.key}
        viewabilityConfig={viewabilityRef.current}
        onViewableItemsChanged={handleViewableItemsChanged}
        contentContainerStyle={{ paddingHorizontal: screenPadding, gap: GAP }}
        decelerationRate="fast"
        snapToInterval={slideW + GAP}
        onScrollBeginDrag={beginInteraction}
        onScrollEndDrag={endInteraction}
        onMomentumScrollEnd={endInteraction}
        renderItem={({ item }) => <HeroSlide slide={item} width={slideW} height={slideH} />}
      />
      {slides.length > 1 ? (
        <View className="mt-2.5 flex-row items-center justify-center" style={{ gap: 6 }}>
          {slides.map((slide, index) => (
            <Pressable
              key={slide.key}
              onPress={() => goTo(index)}
              accessibilityRole="button"
              accessibilityLabel={`Go to slide ${index + 1}`}
              hitSlop={6}
              className="h-1.5 rounded-full"
              style={{
                width: index === activeIndex ? 18 : 6,
                backgroundColor: index === activeIndex ? '#0B594C' : '#D2C4AE',
              }}
            />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

export const HeroCarousel = memo(HeroCarouselInner);

function HeroSlide({
  slide,
  width,
  height,
}: {
  slide: HeroCarouselProps['slides'][number];
  width: number;
  height: number;
}) {
  return (
    <Pressable
      onPress={slide.onPress}
      accessibilityRole="button"
      accessibilityLabel={slide.accessibilityLabel}
    >
      <View
        className="overflow-hidden rounded-2xl"
        style={{ width, height, backgroundColor: '#EFE9DE' }}
      >
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
    </Pressable>
  );
}
