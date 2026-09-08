import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ClosetItemCard } from "../components/ClosetItemCard";
import { removeOutfit } from "../lib/outfitStorage";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "OutfitDetail">;

export function OutfitDetailScreen({ route, navigation }: Props) {
  const { outfit } = route.params;
  const [removing, setRemoving] = useState(false);
  const missingCount = outfit.itemIds.length - outfit.items.length;

  async function handleDelete() {
    if (removing) return;
    setRemoving(true);
    try {
      await removeOutfit(outfit.id);
      navigation.goBack();
    } catch (err) {
      console.warn("[OutfitDetailScreen] Failed to delete outfit:", err);
      setRemoving(false);
    }
  }

  return (
    <View style={styles.container}>
      {missingCount > 0 && (
        <Text style={styles.note}>
          {missingCount} item{missingCount === 1 ? "" : "s"} in this outfit {missingCount === 1 ? "is" : "are"} no
          longer in your closet.
        </Text>
      )}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={outfit.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ClosetItemCard item={item} onPress={() => navigation.navigate("ClosetDetail", { item })} />
        )}
      />

      <Pressable
        style={[styles.deleteButton, removing && styles.deleteButtonDisabled]}
        onPress={handleDelete}
        disabled={removing}
        accessibilityRole="button"
        accessibilityLabel={removing ? "Deleting outfit" : "Delete outfit"}
        accessibilityState={{ disabled: removing }}
      >
        <Text style={styles.deleteButtonText}>{removing ? "Deleting…" : "Delete Outfit"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  note: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontStyle: "italic",
    padding: theme.spacing.md,
    paddingBottom: 0,
  },
  list: { flex: 1 },
  content: { padding: theme.spacing.md },
  deleteButton: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  deleteButtonDisabled: { opacity: 0.6 },
  deleteButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold },
});
