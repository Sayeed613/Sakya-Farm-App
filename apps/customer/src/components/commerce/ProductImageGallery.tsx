import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import {
  Dimensions,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { ProductDetail } from '@sakya/types';
import { cdnImageUri } from '../../lib/cdn-image';

const GALLERY_HEIGHT = 320;

const NEUTRAL_BG = '#F3EDE3';
const FALLBACK_MUTED = '#8C8A80';

export interface ProductImageGalleryProps {
  product: ProductDetail;

  onPressImage?: () => void;

  activeDotColor?: string;
  inactiveDotColor?: string;

  fillHeight?: boolean;

  fixedHeight?: number;

  /**
   * Called when the user starts interacting with
   * the image carousel.
   */
  onCarouselTouchStart?: () => void;

  /**
   * Called when the image carousel interaction ends.
   */
  onCarouselTouchEnd?: () => void;
}

function ProductImageGalleryInner({
  product,
  onPressImage,
  activeDotColor = '#171A18',
  inactiveDotColor = 'rgba(0,0,0,0.20)',
  fixedHeight,
  onCarouselTouchStart,
  onCarouselTouchEnd,
}: ProductImageGalleryProps) {
  const [pageWidth, setPageWidth] = useState(
    () => Dimensions.get('window').width,
  );

  const [index, setIndex] = useState(0);
  const gestureReleaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const urls = useMemo(() => {
    const fromDetail = (product.images ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((image) => image.url)
      .filter((url): url is string => Boolean(url))
      .map((url) => cdnImageUri(url, 720) ?? url);

    return fromDetail.length > 0
      ? fromDetail
      : (product.imageUrls ?? []).map((url) => cdnImageUri(url, 720) ?? url);
  }, [product.images, product.imageUrls]);

  const height = fixedHeight ?? GALLERY_HEIGHT;

  const beginCarouselGesture = () => {
    if (gestureReleaseTimer.current !== null) {
      clearTimeout(gestureReleaseTimer.current);
      gestureReleaseTimer.current = null;
    }
    onCarouselTouchStart?.();
  };

  const finishCarouselGesture = () => {
    if (gestureReleaseTimer.current !== null) clearTimeout(gestureReleaseTimer.current);
    gestureReleaseTimer.current = setTimeout(() => {
      gestureReleaseTimer.current = null;
      onCarouselTouchEnd?.();
    }, 280);
  };

  useEffect(
    () => () => {
      if (gestureReleaseTimer.current !== null) clearTimeout(gestureReleaseTimer.current);
    },
    [],
  );

  const measurePage = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;

    if (nextWidth <= 0) return;

    setPageWidth((previousWidth) =>
      Math.abs(previousWidth - nextWidth) > 1
        ? nextWidth
        : previousWidth,
    );
  };

  const handleScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    if (pageWidth <= 0 || urls.length === 0) {
      finishCarouselGesture();
      return;
    }

    const offsetX = event.nativeEvent.contentOffset.x;

    const page = Math.round(offsetX / pageWidth);

    const nextIndex = Math.min(
      Math.max(page, 0),
      Math.max(urls.length - 1, 0),
    );

    setIndex(nextIndex);

    finishCarouselGesture();
  };

  if (urls.length === 0) {
    return (
      <View
        style={{
          width: '100%',
          height,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: NEUTRAL_BG,
        }}
      >
        <Ionicons
          name="leaf-outline"
          size={44}
          color={FALLBACK_MUTED}
        />
      </View>
    );
  }

  return (
    <View
      onLayout={measurePage}
      style={{
        width: '100%',
        height,
        overflow: 'hidden',
        backgroundColor: NEUTRAL_BG,
      }}
    >
      <ScrollView
        horizontal
        pagingEnabled
        bounces={false}
        directionalLockEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexDirection: 'row' }}
        onTouchStart={beginCarouselGesture}
        onTouchEnd={finishCarouselGesture}
        onTouchCancel={finishCarouselGesture}
        onScrollBeginDrag={beginCarouselGesture}
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollBegin={beginCarouselGesture}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {urls.map((item, imageIndex) => (
          <Pressable
            key={`${product.slug}-${item}-${imageIndex}`}
            onPress={onPressImage}
            accessibilityRole="imagebutton"
            accessibilityLabel="Product image"
            style={{
              width: pageWidth,
              height,
              backgroundColor: NEUTRAL_BG,
            }}
          >
            <Image
              source={{ uri: item }}
              style={{
                width: '100%',
                height: '100%',
              }}
              contentFit="contain"
              cachePolicy="disk"

              /*
               * No image fade/morph.
               * This is a normal horizontal carousel.
               */
              transition={0}
            />
          </Pressable>
        ))}
      </ScrollView>

      {urls.length > 1 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 10,

            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',

            gap: 5,
          }}
        >
          {urls.map((_, imageIndex) => {
            const active = imageIndex === index;

            return (
              <View
                key={`${product.slug}-dot-${imageIndex}`}
                style={{
                  width: active ? 6 : 5,
                  height: active ? 6 : 5,
                  borderRadius: 999,

                  backgroundColor: active
                    ? activeDotColor
                    : inactiveDotColor,
                }}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export const ProductImageGallery = memo(
  ProductImageGalleryInner,
);