import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { goBackOrHome } from '../../lib/navigation';

const INK = '#171A18';

export interface SubScreenHeaderProps {
  title: string;
  /** Defaults to a guarded back (falls back to Home on a cold entry). */
  onBack?: () => void;
  /** Optional trailing slot (actions). Keep to one icon-sized control. */
  right?: ReactNode;
  /** Disable back while a destructive action is in flight. */
  backDisabled?: boolean;
}

/**
 * The one header for every pushed sub-screen (settings, support, wishlist,
 * checkout, notifications, edit/delete…).
 *
 * Before this component each screen hand-rolled its own back button —
 * different sizes (36/40/52), different glyphs (arrow-back vs chevron-back),
 * some with no background — so navigation looked different on every screen.
 * One component fixes the geometry, the glyph and the tap target everywhere.
 */
export function SubScreenHeader({
  title,
  onBack,
  right,
  backDisabled = false,
}: SubScreenHeaderProps) {
  return (
    <View className="flex-row items-center gap-2 px-3 pb-2 pt-2">
      <Pressable
        onPress={onBack ?? goBackOrHome}
        disabled={backDisabled}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        className="h-10 w-10 items-center justify-center rounded-full bg-white"
      >
        <Ionicons name="chevron-back" size={22} color={INK} />
      </Pressable>
      <RNText className="flex-1 text-[17px] font-bold" numberOfLines={1} style={{ color: INK }}>
        {title}
      </RNText>
      {right}
    </View>
  );
}
