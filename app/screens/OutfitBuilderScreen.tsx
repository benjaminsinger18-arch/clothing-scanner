import { useCallback, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ClosetItemCard } from "../components/ClosetItemCard";
import { ErrorState } from "../components/ErrorState";
import { getClosetItems, type ClosetItem } from "../lib/closetStorage";
import { addOutfit } from "../lib/outfitStorage";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "OutfitBuilder">;

/** Multi-select picker over the current closet, ending in a name prompt and a
 * save — the "assemble" half of the real outfit builder (see
 * outfitStorage.ts). Reloads the closet on focus like ClosetScreen, but has
 * no search/filter of its own — outfit-building is a rarer, more deliberate
 * action than browsing the closet, and most closets are small enough that a
 * plain scroll is fine; add search here too if that stops being true. */
export function OutfitBuilderScreen({ navigation }: Props) {
  const [items, setItems] = useState<ClosetItem[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [namePromptVisible, setNamePromptVisible] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getClosetItems()
        .then(setItems)
        .catch(() => setItems([]));
    }, [])
  );

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim() || selectedIds.size === 0 || saving) return;
    setSaving(true);
    try {
      await addOutfit(name, [...selectedIds]);
      setNamePromptVisible(false);
      navigation.goBack();
    } catch (err) {
      console.warn("[OutfitBuilderScreen] Failed to save outfit:", err);
      setSaving(false);
    }
  }

  if (items === null) {
    return <View style={styles.container} />;
  }

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <ErrorState
          title="Your closet is empty"
          detail="Save a few items from their results screen before building an outfit."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.instructions}>Tap items to add them to this outfit ({selectedIds.size} selected)</Text>

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ClosetItemCard item={item} onPress={() => toggle(item.id)} selected={selectedIds.has(item.id)} />
        )}
      />

      <Pressable
        style={[styles.continueButton, selectedIds.size === 0 && styles.continueButtonDisabled]}
        onPress={() => setNamePromptVisible(true)}
        disabled={selectedIds.size === 0}
        accessibilityRole="button"
        accessibilityLabel="Name and save this outfit"
        accessibilityState={{ disabled: selectedIds.size === 0 }}
      >
        <Text style={styles.continueButtonText}>Name &amp; Save ({selectedIds.size})</Text>
      </Pressable>

      <Modal
        visible={namePromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNamePromptVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this outfit</Text>
            <TextInput
              style={styles.modalInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Weekend brunch"
              placeholderTextColor={theme.colors.textSecondary}
              autoFocus
              editable={!saving}
              accessibilityLabel="Outfit name"
            />
            <View style={styles.modalButtonRow}>
              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setNamePromptVisible(false)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSaveButton, (!name.trim() || saving) && styles.continueButtonDisabled]}
                onPress={handleSave}
                disabled={!name.trim() || saving}
                accessibilityRole="button"
                accessibilityLabel="Save outfit"
                accessibilityState={{ disabled: !name.trim() || saving }}
              >
                <Text style={styles.modalSaveButtonText}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  instructions: { color: theme.colors.textSecondary, fontSize: 13, padding: theme.spacing.md, paddingBottom: 0 },
  list: { flex: 1 },
  content: { padding: theme.spacing.md },
  continueButton: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  continueButtonDisabled: { opacity: 0.5 },
  continueButtonText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.bold },
  modalOverlay: {
    flex: 1,
    backgroundColor: theme.colors.overlay(0.7),
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  modalCard: {
    width: "100%",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  modalTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontFamily: theme.fonts.body.semiBold,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    color: theme.colors.textPrimary,
    fontSize: 15,
    marginBottom: 16,
  },
  modalButtonRow: { flexDirection: "row", gap: 10 },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    alignItems: "center",
    backgroundColor: theme.colors.surfaceAlt,
  },
  modalCancelButtonText: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.semiBold },
  modalSaveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    alignItems: "center",
    backgroundColor: theme.colors.accent,
  },
  modalSaveButtonText: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.bold },
});
