import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { ClosetItemCard } from "../components/ClosetItemCard";
import { ErrorState } from "../components/ErrorState";
import { Section } from "../components/Section";
import { getClosetItems, type ClosetItem } from "../lib/closetStorage";
import { getAllWearStats, type WearStats } from "../lib/wearLog";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../lib/categoryLabels";
import { theme } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Insights">;

// A closet item this long without being worn (or, if never worn, this long
// since it was saved) surfaces in the "Haven't worn lately" list below. Not
// user-configurable — a fixed, product-decided threshold, same spirit as the
// hard-coded price-range constants in server/src/lib/priceMath.ts.
const STALE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
// How many entries the color breakdown shows — the closet can carry far more
// distinct colors than are useful to chart, so this caps it to the ones that
// actually make up a meaningful share of the wardrobe.
const MAX_COLORS_SHOWN = 6;

interface Insights {
  items: ClosetItem[];
  wearByItem: Map<string, WearStats>;
  totalValue: number;
  pricedCount: number;
  categoryCounts: { key: string; label: string; count: number }[];
  colorCounts: { label: string; count: number }[];
  staleItems: ClosetItem[];
}

function computeInsights(items: ClosetItem[], wearByItem: Map<string, WearStats>): Insights {
  let totalValue = 0;
  let pricedCount = 0;
  const byCategory = new Map<string, number>();
  const byColor = new Map<string, number>();
  const staleItems: ClosetItem[] = [];
  const staleCutoff = Date.now() - STALE_DAYS * DAY_MS;

  for (const item of items) {
    if (item.priceRange) {
      totalValue += item.priceRange.median;
      pricedCount += 1;
    }

    const category = item.classification.category;
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);

    // Title-cased so "navy" and "Navy" (or any casing variance across scans)
    // count as the same color instead of splitting the breakdown two ways.
    const color = item.classification.color.trim().toLowerCase();
    if (color) byColor.set(color, (byColor.get(color) ?? 0) + 1);

    const lastWornAt = wearByItem.get(item.id)?.lastWornAt ?? null;
    const referenceTime = new Date(lastWornAt ?? item.savedAt).getTime();
    if (referenceTime <= staleCutoff) staleItems.push(item);
  }

  // Oldest reference date first — the most-neglected item leads the list.
  staleItems.sort((a, b) => {
    const aTime = new Date(wearByItem.get(a.id)?.lastWornAt ?? a.savedAt).getTime();
    const bTime = new Date(wearByItem.get(b.id)?.lastWornAt ?? b.savedAt).getTime();
    return aTime - bTime;
  });

  const categoryCounts = CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    count: byCategory.get(c)!,
  }));

  const colorCounts = [...byColor.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COLORS_SHOWN)
    .map(([label, count]) => ({ label, count }));

  return { items, wearByItem, totalValue, pricedCount, categoryCounts, colorCounts, staleItems };
}

/** Read-only aggregate view over the whole closet (see closetStorage.ts) plus
 * wear history (see wearLog.ts) — total estimated value, a category/color
 * breakdown, and which saved items have gone the longest without being worn.
 * Entirely local: no server call, no external API spend, so unlike most of
 * this app's screens there's no loading spinner for a network round trip —
 * just a brief blank frame while SQLite answers a few queries. */
export function InsightsScreen({ navigation }: Props) {
  const [insights, setInsights] = useState<Insights | null>(null);

  const load = useCallback(() => {
    Promise.all([getClosetItems(), getAllWearStats()])
      .then(([items, wearByItem]) => setInsights(computeInsights(items, wearByItem)))
      .catch(() => setInsights(computeInsights([], new Map())));
  }, []);

  // Same "reload on every focus" convention as Closet/Outfits/Settings — a
  // wear logged or an item removed elsewhere should be reflected next time
  // this screen is visited, without needing its own change-subscription.
  useFocusEffect(load);

  if (insights === null) {
    return <View style={styles.container} />;
  }

  if (insights.items.length === 0) {
    return (
      <View style={styles.container}>
        <ErrorState title="Nothing to show yet" detail="Save a few items to your closet to see insights about them." />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="Closet value">
        <View style={styles.valueRow}>
          <Text style={styles.valueText}>${insights.totalValue.toFixed(2)}</Text>
          <Text style={styles.valueCaption}>
            estimated, based on {insights.pricedCount} of {insights.items.length} saved item
            {insights.items.length === 1 ? "" : "s"}
          </Text>
        </View>
      </Section>

      <Section title="By category">
        {insights.categoryCounts.map(({ key, label, count }) => (
          <StatBarRow key={key} label={label} count={count} total={insights.items.length} />
        ))}
      </Section>

      {insights.colorCounts.length > 0 && (
        <Section title="By color">
          {insights.colorCounts.map(({ label, count }) => (
            <StatBarRow
              key={label}
              label={label[0].toUpperCase() + label.slice(1)}
              count={count}
              total={insights.items.length}
            />
          ))}
        </Section>
      )}

      {insights.staleItems.length > 0 && (
        <View style={styles.staleSection}>
          <Text style={styles.staleSectionTitle}>Haven’t worn in {STALE_DAYS}+ days</Text>
          {insights.staleItems.map((item) => (
            <ClosetItemCard key={item.id} item={item} onPress={() => navigation.navigate("ClosetDetail", { item })} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function StatBarRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? count / total : 0;
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowMeta}>{count}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md },
  valueRow: { padding: theme.spacing.md },
  valueText: { color: theme.colors.accent, fontSize: 28, fontFamily: theme.fonts.display.bold },
  valueCaption: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 },
  row: { padding: theme.spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  rowLabel: { color: theme.colors.textPrimary, fontSize: 15, fontFamily: theme.fonts.body.medium },
  rowMeta: { color: theme.colors.textSecondary, fontSize: 12, fontVariant: ["tabular-nums"] },
  track: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceAlt, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3, backgroundColor: theme.colors.accent },
  staleSection: { marginTop: theme.spacing.xs },
  staleSectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: theme.letterSpacing.label,
    marginBottom: 8,
  },
});
