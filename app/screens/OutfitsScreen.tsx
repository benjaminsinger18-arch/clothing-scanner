import { useCallback, useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ErrorState } from "../components/ErrorState";
import { getOutfitsWithItems, type ResolvedOutfit } from "../lib/outfitStorage";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Outfits">;

/** List of user-assembled outfits — see outfitStorage.ts for why this is a
 * separate feature from Results' AI-suggested "Outfit Matches" tab. */
export function OutfitsScreen({ navigation }: Props) {
  const [outfits, setOutfits] = useState<ResolvedOutfit[] | null>(null);

  const load = useCallback(() => {
    getOutfitsWithItems()
      .then(setOutfits)
      .catch(() => setOutfits([]));
  }, []);

  // Reload on every focus — covers both a newly-saved outfit (returning from
  // OutfitBuilder) and a closet item removed elsewhere changing which items
  // an existing outfit can still resolve (see getOutfitsWithItems).
  useFocusEffect(load);

  if (outfits === null) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.newButton}
        onPress={() => navigation.navigate("OutfitBuilder")}
        accessibilityRole="button"
        accessibilityLabel="Build a new outfit"
      >
        <Text style={styles.newButtonText}>+ Build an Outfit</Text>
      </Pressable>

      {outfits.length === 0 ? (
        <ErrorState
          title="No outfits yet"
          detail="Combine a few pieces from your closet into a named outfit you can come back to."
        />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={outfits}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => navigation.navigate("OutfitDetail", { outfit: item })}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.items.length} item${item.items.length === 1 ? "" : "s"}`}
            >
              <View style={styles.thumbRow}>
                {item.items
                  .slice(0, 3)
                  .map((closetItem) =>
                    closetItem.photoThumbnail ? (
                      <Image
                        key={closetItem.id}
                        source={{ uri: closetItem.photoThumbnail }}
                        style={styles.thumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <View key={closetItem.id} style={styles.thumbPlaceholder} />
                    )
                  )}
              </View>
              <View style={styles.textCol}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta}>
                  {item.items.length} item{item.items.length === 1 ? "" : "s"}
                  {item.itemIds.length !== item.items.length ? " (some no longer in your closet)" : ""}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const THUMB_SIZE = 44;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  newButton: {
    margin: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  newButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.bold },
  list: { flex: 1 },
  content: { padding: theme.spacing.md, paddingTop: 0 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardPressed: { opacity: 0.7 },
  thumbRow: { flexDirection: "row", gap: 6, flexShrink: 0 },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
  },
  thumbPlaceholder: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
  },
  textCol: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.semiBold },
  meta: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 },
});
