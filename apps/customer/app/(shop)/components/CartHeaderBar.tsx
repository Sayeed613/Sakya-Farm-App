import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text as RNText, View } from 'react-native';
import { goBackOrHome } from '../../../src/lib/navigation';
import { router } from 'expo-router';

interface CartHeaderBarProps {
  count: number;
}

export default function CartHeaderBar({ count }: CartHeaderBarProps) {
  const INK = '#171A18';

  return (
    <View className="h-12 flex-row items-center justify-between px-2">
      <Pressable
        onPress={goBackOrHome}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        className="h-[38px] w-[38px] items-center justify-center active:opacity-60"
      >
        <Ionicons name="chevron-back" size={23} color={INK} />
      </Pressable>

      <RNText className="text-[15px] font-bold tracking-[-0.1px] text-ink">
        {count > 0 ? `Your Cart (${count})` : 'Your Cart'}
      </RNText>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search"
        hitSlop={8}
        onPress={() => router.push('/search')}
        className="h-[38px] w-[38px] items-center justify-center active:opacity-60"
      >
        <Ionicons name="search-outline" size={21} color={INK} />
      </Pressable>
    </View>
  );
}