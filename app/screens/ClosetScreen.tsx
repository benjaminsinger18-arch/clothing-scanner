import { useCallback, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ClosetItemCard } from "../components/ClosetItemCard";
import { ErrorState } from "../components/ErrorState";
import { getClosetItems, removeClosetItem, type ClosetItem } from "../lib/closetStorage";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Closet">;

export function ClosetScreen(_props: Props) {
  // null = "haven't loaded yet" (distinct from "loaded, empty") so the empty
  // state doesn't flash briefly before the real list on every visit.
  const [items, setItems] = useState<ClosetItem[] | null>(null);

  const load = useCallback(() => {
    getClosetItems()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  // Reload every time this screen gains focus, not just on first mount — a
  // save made on ResultsScreen (or a removal made here on a prior visit)
  // should show up without forcing a full remount of this screen.
  useFocusEffect(load);

  async function handleRemove(id: string) {
    // Optimistic — the row disappears immediately rather than waiting on the
    // AsyncStorage round trip.
    setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));
    await removeClosetItem(id);
  }

  if (items === null) {
    return <View style={styles.container} />;
  }

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <ErrorState title="Your closet is empty" detail="Save an item from its results screen to start building it." />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ClosetItemCard item={item} onRemove={() => handleRemove(item.id)} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md },
});
