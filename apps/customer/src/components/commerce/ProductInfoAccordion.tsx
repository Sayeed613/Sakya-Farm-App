import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const INK = '#171A18';
const MUTED = '#8C8A80';
const LINE = '#E4DED2';

export interface AccordionSection {
  key: string;
  title: string;
  /** Plain-text body paragraphs. Only render the section when non-empty. */
  body: string[];
}

/**
 * One accordion row. Height animates via measured content height (onLayout),
 * so any body length collapses smoothly without measuring hacks.
 */
function AccordionRowInner({ section, expanded, onToggle }: {
  section: AccordionSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  const height = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    height: height.value,
    overflow: 'hidden' as const,
  }));

  // Drive the animation from the `expanded` prop (effect, not render, so the
  // shared value is never mutated during render).
  useEffect(() => {
    if (expanded && contentHeight > 0) {
      height.value = withTiming(contentHeight, { duration: 220 });
    } else if (!expanded) {
      height.value = withTiming(0, { duration: 180 });
    }
  }, [expanded, contentHeight, height]);

  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={section.title}
        className="flex-row items-center justify-between py-3.5"
      >
        <RNText className="text-[14px] font-bold" style={{ color: INK }}>
          {section.title}
        </RNText>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={MUTED}
        />
      </Pressable>
      <Animated.View style={style}>
        <View
          onLayout={(event) => {
            const measured = event.nativeEvent.layout.height;
            if (measured > 0 && measured !== contentHeight) setContentHeight(measured);
          }}
          className="pb-3"
        >
          {section.body.map((paragraph, index) => (
            <RNText
              key={index}
              className="text-[13px] leading-5"
              style={{ color: MUTED, marginBottom: index < section.body.length - 1 ? 8 : 0 }}
            >
              {paragraph}
            </RNText>
          ))}
        </View>
      </Animated.View>
      <View className="h-px" style={{ backgroundColor: LINE }} />
    </View>
  );
}

export const AccordionRow = memo(AccordionRowInner);

/**
 * The full accordion list. Sections render only when data exists (the caller
 * filters). One section may be open at a time, matching the reference sheet.
 */
export function ProductInfoAccordion({
  sections,
}: {
  sections: AccordionSection[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <View>
      {sections.map((section) => (
        <AccordionRow
          key={section.key}
          section={section}
          expanded={openKey === section.key}
          onToggle={() => setOpenKey((current) => (current === section.key ? null : section.key))}
        />
      ))}
    </View>
  );
}
