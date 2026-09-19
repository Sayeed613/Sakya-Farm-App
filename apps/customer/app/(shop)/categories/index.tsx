import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FlatList, Pressable, StyleSheet } from 'react-native';

import { catalogApi } from '../../../src/api/catalog';
import { ErrorState } from '../../../src/components/ErrorState';
import { LoadingState } from '../../../src/components/LoadingState';
import { Screen } from '../../../src/components/Screen';
import { Text } from '../../../src/components/Text';
import { colors, spacing } from '../../../src/theme';

export default function Categories() {
  const categories = useQuery({ queryKey: ['catalog', 'categories'], queryFn: catalogApi.listCategories });
  if (categories.isLoading) return <LoadingState />;
  if (categories.isError) return <ErrorState message="We could not load categories." onRetry={() => void categories.refetch()} />;
  return (
    <Screen>
      <Text variant="title">Categories</Text>
      <FlatList
        contentContainerStyle={styles.list}
        data={categories.data ?? []}
        keyExtractor={(item) => item.slug}
        ListEmptyComponent={<Text color={colors.textMuted}>No categories are available.</Text>}
        renderItem={({ item }) => (
          <Link href={`/(shop)/categories/${item.slug}`} asChild>
            <Pressable accessibilityRole="button" style={styles.card}>
              <Text variant="heading">{item.name}</Text>
              <Text color={colors.textMuted}>{item.productCount} products</Text>
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
