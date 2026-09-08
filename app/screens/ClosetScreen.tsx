import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ClosetItemCard } from "../components/ClosetItemCard";
import { ErrorState } from "../components/ErrorState";
import { getClosetCategories, queryClosetItems, removeClosetItem, type ClosetItem } from "../lib/closetStorage";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Closet">;

/** Display labels for the 8 category values a classification can carry —
 * fixed canonical order (rather than the alphabetical order SQLite's
 * `getClosetCategories` returns) so the filter bar reads like a considered
 * list, not a database dump. Categories with no saved items simply don't
 * appear (see the `.filter` below), rather than showing an always-empty chip. */
const CATEGORY_ORDER = [
  "tops",
  "bottoms",
  "outerwear",
  "dresses",
  "footwear",
  "activewear",
  "underwear-sleepwear",
  "accessories",
] as const;
const CATEGORY_LABELS: Record<string, string> = {
  tops: "Tops",
  bottoms: "Bottoms",
  outerwear: "Outerwear",
  dresses: "Dresses",
  footwear: "Footwear",
  activewear: "Activewear",
  "underwear-sleepwear": "Underwear & Sleepwear",
  accessories: "Accessories",
};

// How long to wait after the last keystroke before actually re-querying —
// SQLite itself is fast enough not to need this for correctness (the closet
// is capped at 150 items), but debouncing avoids a query-per-keystroke churn
// while someone's still typing.
const SEARCH_DEBOUNCE_MS = 250;

export function ClosetScreen({ navigation }: Props) {
  // null = "haven't loaded yet" (distinct from "loaded, empty") so the empty
  // state doesn't flash briefly before the real list on every visit.
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const [categoriesPresent, setCategoriesPresent] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState(""); // what the TextInput shows, updated every keystroke
  const [search, setSearch] = useState(""); // debounced value that actually drives the query
  const [category, setCategory] = useState<string | null>(null); // null = "All"
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on every screen focus so the data-loading effect below reruns even
  // when search/category haven't changed (e.g. returning from Results after
  // saving a new item) — see that effect's own comment.
  const [focusTick, setFocusTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFocusTick((t) => t + 1);
    }, [])
  );

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // The single source of truth for what's on screen — reruns whenever the
  // debounced search text or category filter changes, or the screen refocuses
  // (via focusTick). Always reads the *current* search/category values
  // directly (not through a memoized callback), so there's no stale-closure
  // risk the way piggybacking on useFocusEffect's own callback-identity timing
  // would have.
  useEffect(() => {
    queryClosetItems({ search, category: category ?? undefined })
      .then(setItems)
      .catch(() => setItems([]));
    getClosetCategories()
      .then(setCategoriesPresent)
      .catch(() => setCategoriesPresent([]));
  }, [search, category, focusTick]);

  // Pull-to-refresh, separate from the effect above: this one needs its own
  // loading flag so RefreshControl's spinner can turn off once the read
  // completes, instead of the fire-and-forget focus/filter-triggered effect.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [newItems, cats] = await Promise.all([
        queryClosetItems({ search, category: category ?? undefined }),
        getClosetCategories(),
      ]);
      setItems(newItems);
      setCategoriesPresent(cats);
    } catch {
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, [search, category]);

  async function handleRemove(id: string) {
    // Optimistic — the row disappears immediately rather than waiting on the
    // database round trip.
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
    await removeClosetItem(id);
    // A removal can change which categories still have items (e.g. removing
    // the last "dresses" entry) — re-derive the chip bar too, not just the list.
    getClosetCategories()
      .then(setCategoriesPresent)
      .catch(() => {});
  }

  const closetIsEmpty = items !== null && items.length === 0 && categoriesPresent.length === 0;
  const noFilterMatches = items !== null && items.length === 0 && categoriesPresent.length > 0;

  if (items === null) {
    return <View style={styles.container} />;
  }

  if (closetIsEmpty) {
    return (
      <View style={styles.container}>
        <ErrorState title="Your closet is empty" detail="Save an item from its results screen to start building it." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search your closet…"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search your closet"
          accessibilityHint="Matches garment type, category, color, and brand"
        />
      </View>

      {categoriesPresent.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}
        >
          <Pressable
            onPress={() => setCategory(null)}
            style={[styles.filterChip, category === null && styles.filterChipActive]}
            accessibilityRole="button"
            accessibilityLabel="All categories"
            accessibilityState={{ selected: category === null }}
          >
            <Text style={[styles.filterChipText, category === null && styles.filterChipTextActive]}>All</Text>
          </Pressable>
          {CATEGORY_ORDER.filter((c) => categoriesPresent.includes(c)).map((c) => (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={[styles.filterChip, category === c && styles.filterChipActive]}
              accessibilityRole="button"
              accessibilityLabel={CATEGORY_LABELS[c]}
              accessibilityState={{ selected: category === c }}
            >
              <Text style={[styles.filterChipText, category === c && styles.filterChipTextActive]}>
                {CATEGORY_LABELS[c]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {noFilterMatches ? (
        <ErrorState
          title="No items match"
          detail={
            search && category
              ? `Nothing in ${CATEGORY_LABELS[category]} matches "${search}".`
              : search
                ? `Nothing matches "${search}".`
                : `Nothing in ${CATEGORY_LABELS[category!]} yet.`
          }
        />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.accent} />
          }
          renderItem={({ item }) => (
            <ClosetItemCard
              item={item}
              onPress={() => navigation.navigate("ClosetDetail", { item })}
              onRemove={() => handleRemove(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  searchRow: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm },
  searchInput: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    color: theme.colors.textPrimary,
    fontSize: 15,
  },
  filterBar: { maxHeight: 44, marginTop: theme.spacing.sm },
  filterBarContent: { paddingHorizontal: theme.spacing.md, alignItems: "center", gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceAlt,
  },
  filterChipActive: { backgroundColor: theme.colors.accent },
  filterChipText: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.semiBold },
  filterChipTextActive: { color: theme.colors.textPrimary },
  list: { flex: 1 },
  content: { padding: theme.spacing.md },
});
