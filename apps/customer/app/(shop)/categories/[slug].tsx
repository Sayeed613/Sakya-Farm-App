import { Link, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { catalogApi } from '../../../src/api/catalog';
import { ErrorState } from '../../../src/components/ErrorState';
import { LoadingState } from '../../../src/components/LoadingState';
import { Screen } from '../../../src/components/Screen';
import { Text } from '../../../src/components/Text';
import { colors, spacing } from '../../../src/theme';

export default function CategoryProducts() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const products = useQuery({
    queryKey: ['catalog', 'category', slug],
    queryFn: () => catalogApi.listCategoryProducts(slug),
    enabled: Boolean(slug),
  });
  if (products.isLoading) return <LoadingState />;
  if (products.isError) return <ErrorState message="We could not load this category." onRetry={() => void products.refetch()} />;
  return (
    <Screen>
      <Text variant="title">{slug}</Text>
      <FlatList
        contentContainerStyle={styles.list}
        data={products.data?.items ?? []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text color={colors.textMuted}>No products are available in this category.</Text>}
        renderItem={({ item }) => (
          <Link href={`/(shop)/products/${item.slug}`} asChild>
            <Pressable accessibilityRole="button" style={styles.card}>
              <Text variant="heading">{item.title}</Text>
              <Text color={colors.textMuted}>
                {item.price ? `₹${(item.price.minInPaise / 100).toFixed(2)}` : 'Price unavailable'}
              </Text>
            </Pressable>
          </Link>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md, paddingTop: spacing.lg },
  card: { borderColor: colors.border, borderRadius: 16, borderWidth: 1, gap: spacing.xs, padding: spacing.lg },
});
