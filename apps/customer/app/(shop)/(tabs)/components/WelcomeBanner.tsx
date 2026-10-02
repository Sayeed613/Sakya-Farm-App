import { HeroCarousel } from '../../../../src/components/home/HeroCarousel';

interface WelcomeBannerProps {
  slides: Array<{
    key: string;
    image: import('react-native').ImageSourcePropType;
    accessibilityLabel: string;
    onPress: () => void;
  }>;
}

export default function WelcomeBanner({ slides }: WelcomeBannerProps) {
  if (slides.length === 0) return null;
  return <HeroCarousel slides={slides} />;
}