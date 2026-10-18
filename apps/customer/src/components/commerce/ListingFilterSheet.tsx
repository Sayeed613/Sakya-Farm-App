import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Modal, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';

import { AnimatedPressable, usePressScale } from '../../lib/motion';

const BRAND = '#0B594C';
const INK = '#171A18';
const MUTED = '#8C8A80';

export type SortOption = 'Relevance' | 'Price: low to high' | 'Price: high to low' | 'Freshness';
export type AvailabilityFilter = 'In stock' | 'On sale';

export const SORT_OPTIONS: readonly SortOption[] = [
  'Relevance',
  'Price: low to high',
  'Price: high to low',
  'Freshness',
];
export const AVAILABILITY_OPTIONS: readonly AvailabilityFilter[] = ['In stock', 'On sale'];

export interface ListingFilterState {
  sort: SortOption;
  filter: AvailabilityFilter | null;
  packFilter: string | null;
}

export function hasActiveFilters(state: ListingFilterState): boolean {
  return state.sort !== 'Relevance' || state.filter !== null || state.packFilter !== null;
}

export interface ListingFilterSheetProps {
  visible: boolean;
  state: ListingFilterState;
  /** Real variant titles of the current category (Type section). Empty = hidden. */
  packOptions: string[];
  /** Live result count for the footer button ("Show 12 items"). */
  resultCount: number;
  onSortChange: (sort: SortOption) => void;
  onFilterChange: (filter: AvailabilityFilter | null) => void;
  onPackChange: (pack: string | null) => void;
  /** Reset every section back to defaults. */
  onClearAll: () => void;
  onClose: () => void;
}

/**
 * ListingFilterSheet — the redesigned filter surface for the Fresh listing.
 *
 * Replaces the old floating dropdown menus with one bottom sheet (same
 * architecture as VariantPickerSheet: transparent Modal, backdrop sibling,
 * slide-in panel). Sections: Sort (radio rows), Show only (toggle chips),
 * Pack size (toggle chips, when the category has real variant titles).
 * Changes apply live; "Clear all" in the footer resets everything, and the
 * results button closes the sheet showing the live count.
 */
function ListingFilterSheetInner({
  visible,
  state,
  packOptions,
  resultCount,
  onSortChange,
  onFilterChange,
  onPackChange,
  onClearAll,
  onClose,
}: ListingFilterSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss filters"
          onPress={onClose}
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
        />
        {/* Backdrop stays a SIBLING of the sheet (see VariantPickerSheet): as
            an ancestor it wraps inner buttons in a nested <button> on web. */}
        <View className="absolute inset-0 justify-end" style={{ pointerEvents: 'box-none' }}>
          <Pressable onPress={() => undefined}>
            <Animated.View
              entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic))}
              exiting={SlideOutDown.duration(180).easing(Easing.in(Easing.cubic))}
              // Sheet chrome INLINE (not className): Animated.View has no
              // cssInterop in this app — classes silently never reach the DOM.
              style={{
                backgroundColor: '#FBF7F0', // colors.canvas
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: Math.max(insets.bottom, 12) + 8,
              }}
            >
              <View className="items-center pb-2">
                <View className="h-1 w-10 rounded-full bg-line" />
              </View>

              <View className="flex-row items-center justify-between pb-1">
                <RNText className="text-[17px] font-bold text-ink">Sort & filter</RNText>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close filters"
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full active:bg-surface-muted"
                >
                  <Ionicons name="close" size={18} color={MUTED} />
                </Pressable>
              </View>

              {/* ── Sort ─────────────────────────────────────────────── */}
              <RNText className="pb-1 pt-2 text-[12px] font-bold uppercase tracking-wide text-ink-soft">
                Sort by
              </RNText>
              <View className="gap-0.5">
                {SORT_OPTIONS.map((option) => {
                  const selected = state.sort === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => onSortChange(option)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      className="flex-row items-center justify-between rounded-xl px-3 py-2.5 active:bg-surface-muted"
                    >
                      <RNText className={'text-[13.5px] ' + (selected ? 'font-bold' : 'font-medium')} style={{ color: INK }}>
                        {option}
                      </RNText>
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={17}
                        color={selected ? BRAND : '#C7C3B8'}
                      />
                    </Pressable>
                  );
                })}
              </View>

              {/* ── Show only ────────────────────────────────────────── */}
              <RNText className="pb-1.5 pt-3 text-[12px] font-bold uppercase tracking-wide text-ink-soft">
                Show only
              </RNText>
              <View className="flex-row flex-wrap gap-2">
                {AVAILABILITY_OPTIONS.map((option) => {
                  const selected = state.filter === option;
                  return (
                    <FilterChip
                      key={option}
                      label={option}
                      selected={selected}
                      onPress={() => onFilterChange(selected ? null : option)}
                    />
                  );
                })}
              </View>

              {/* ── Pack size ────────────────────────────────────────── */}
              {packOptions.length > 0 ? (
                <>
                  <RNText className="pb-1.5 pt-3 text-[12px] font-bold uppercase tracking-wide text-ink-soft">
                    Pack size
                  </RNText>
                  <View className="flex-row flex-wrap gap-2">
                    {packOptions.map((option) => {
                      const selected = state.packFilter === option;
                      return (
                        <FilterChip
                          key={option}
                          label={option}
                          selected={selected}
                          onPress={() => onPackChange(selected ? null : option)}
                        />
                      );
                    })}
                  </View>
                </>
              ) : null}

              {/* ── Footer: Clear all + results ──────────────────────── */}
              <View className="mt-4 flex-row items-center gap-3">
                <Pressable
                  onPress={onClearAll}
                  accessibilityRole="button"
                  accessibilityLabel="Clear all filters"
                  className="h-12 items-center justify-center rounded-2xl border border-brand px-6 active:opacity-70"
                >
                  <RNText className="text-[13.5px] font-bold" style={{ color: BRAND }}>
                    Clear all
                  </RNText>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${resultCount} items`}
                  className="h-12 flex-1 items-center justify-center rounded-2xl active:opacity-85"
                  style={{ backgroundColor: BRAND }}
                >
                  <RNText className="text-[14px] font-bold text-white">
                    Show {resultCount} item{resultCount === 1 ? '' : 's'}
                  </RNText>
                </Pressable>
              </View>
            </Animated.View>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

/** Toggle chip used by the Show only / Pack size sections. */
function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const press = usePressScale();

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Filter ${label}`}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={press.animatedStyle}
      className={
        'flex-row items-center gap-1.5 rounded-full border px-3.5 py-2 ' +
        (selected ? 'border-brand bg-brand/10' : 'border-line bg-white')
      }
    >
      {selected ? <Ionicons name="checkmark" size={13} color={BRAND} /> : null}
      <RNText className={'text-[12.5px] ' + (selected ? 'font-bold' : 'font-medium')} style={{ color: selected ? BRAND : INK }}>
        {label}
      </RNText>
    </AnimatedPressable>
  );
}

export const ListingFilterSheet = memo(ListingFilterSheetInner);
