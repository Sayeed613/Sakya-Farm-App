import { Text as RNText, View } from 'react-native';

import { BRAND_PHILOSOPHY } from '../../../../src/config/home-content';

export default function BrandPhilosophy() {
  return (
    <View className="mt-8 items-center gap-1.5 px-10 pb-2">
      <RNText className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">
        {BRAND_PHILOSOPHY.eyebrow}
      </RNText>
      <RNText className="text-center font-serif text-[19px] leading-6 text-ink">
        {BRAND_PHILOSOPHY.heading}
      </RNText>
      <RNText className="mt-1 text-center text-[13px] leading-5 text-ink-soft">
        {BRAND_PHILOSOPHY.body}
      </RNText>
    </View>
  );
}
