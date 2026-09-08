import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { UsageCounter, UsageSnapshot } from "@clothing-scanner/shared-types";
import { ErrorState } from "../components/ErrorState";
import { toErrorInfo } from "../lib/errors";
import { clearCloset, getClosetItems } from "../lib/closetStorage";
import { getUsage } from "../services/api";
import { theme } from "../theme";

// There was previously no Settings screen at all — no way to export or clear
// closet data, and no visibility into the provider usage GET /usage now
// exposes (see rateLimitTracker.ts) short of reading Render's console logs.
// This is the home for all three, plus wherever else a "you + friends" scale
// app accumulates over time.

const USAGE_LABELS: Record<keyof UsageSnapshot, string> = {
  serpapi: "SerpApi — pricing",
  vision: "Google Vision",
  gemini: "Gemini rescue",
  upc: "UPCitemdb — barcode",
  webSearch: "Claude web search — corrections",
  serpapiOutfit: "SerpApi — outfit matches",
};

export function SettingsScreen() {
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageError, setUsageError] = useState<{ title: string; detail?: string } | null>(null);

  const loadUsage = useCallback(() => {
    setUsageError(null);
    getUsage()
      .then(setUsage)
      .catch((err) => setUsageError(toErrorInfo(err, "Couldn't load usage")));
  }, []);

  // Reload on every focus, same convention as Closet/Outfits — cheap (no
  // external calls on the server's side, see usage.ts) and keeps the numbers
  // reasonably current if you leave this screen open across a scan elsewhere.
  useFocusEffect(loadUsage);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const items = await getClosetItems();
      const file = new File(Paths.cache, `closet-export-${Date.now()}.json`);
      file.create({ overwrite: true });
      file.write(JSON.stringify(items, null, 2));

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing isn't available", "Your device doesn't support the share sheet.");
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Export closet" });
    } catch (err) {
      console.warn("[SettingsScreen] Failed to export closet:", err);
      Alert.alert("Export failed", "Something went wrong exporting your closet. Try again.");
    } finally {
      setExporting(false);
    }
  }

  function handleClear() {
    Alert.alert("Clear your closet?", "This permanently deletes every saved item. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear Closet",
        style: "destructive",
        onPress: async () => {
          setClearing(true);
          try {
            await clearCloset();
            Alert.alert("Closet cleared");
          } catch (err) {
            console.warn("[SettingsScreen] Failed to clear closet:", err);
            Alert.alert("Something went wrong", "Your closet may not have been fully cleared. Try again.");
          } finally {
            setClearing(false);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="Your data">
        <Pressable
          style={styles.row}
          onPress={handleExport}
          disabled={exporting}
          accessibilityRole="button"
          accessibilityLabel="Export closet as JSON"
          accessibilityState={{ disabled: exporting }}
        >
          <Text style={styles.rowLabel}>{exporting ? "Exporting…" : "Export closet as JSON"}</Text>
        </Pressable>
        <Pressable
          style={styles.row}
          onPress={handleClear}
          disabled={clearing}
          accessibilityRole="button"
          accessibilityLabel="Clear closet"
          accessibilityState={{ disabled: clearing }}
        >
          <Text style={[styles.rowLabel, styles.destructiveText]}>{clearing ? "Clearing…" : "Clear closet"}</Text>
        </Pressable>
      </Section>

      <Section title="Provider usage this period">
        {usageError ? (
          <ErrorState title={usageError.title} detail={usageError.detail} onRetry={loadUsage} />
        ) : usage ? (
          (Object.keys(USAGE_LABELS) as (keyof UsageSnapshot)[]).map((key) => (
            <UsageRow key={key} label={USAGE_LABELS[key]} counter={usage[key]} />
          ))
        ) : (
          <Text style={styles.rowMeta}>Loading…</Text>
        )}
      </Section>

      <Section title="About">
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValueText}>{Constants.expoConfig?.version ?? "—"}</Text>
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function UsageRow({ label, counter }: { label: string; counter: UsageCounter }) {
  const pct = counter.cap > 0 ? Math.min(1, counter.count / counter.cap) : 0;
  // Amber past 75% of cap, red past 95% — same "getting close" signal a
  // provider's own dashboard would show, just derived from this app's own
  // soft caps (rateLimitTracker.ts) rather than the provider's hard quota.
  const barColor = pct >= 0.95 ? "#ef4444" : pct >= 0.75 ? "#f59e0b" : theme.colors.accent;

  return (
    <View style={styles.row}>
      <View style={styles.usageHeader}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowMeta}>
          {counter.count} / {counter.cap} per {counter.period}
        </Text>
      </View>
      <View style={styles.usageTrack}>
        <View style={[styles.usageFill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md },
  section: { marginBottom: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.label,
    marginBottom: 8,
  },
  sectionBody: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  row: { padding: theme.spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  rowLabel: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.medium },
  rowMeta: { color: theme.colors.textSecondary, fontSize: 12, fontVariant: ["tabular-nums"] },
  rowValueText: { color: theme.colors.textSecondary, fontSize: 14, marginTop: 2 },
  destructiveText: { color: "#ef4444" },
  usageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  usageTrack: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceAlt, overflow: "hidden" },
  usageFill: { height: "100%", borderRadius: 3 },
});
