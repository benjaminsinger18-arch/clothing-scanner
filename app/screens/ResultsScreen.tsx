import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OutfitSuggestionsResult, PriceSearchResult } from "@clothing-scanner/shared-types";
import type { RootStackParamList } from "../navigation/types";
import { toErrorInfo } from "../lib/errors";
import { getOutfitSuggestions, searchPrices } from "../services/api";
import { addClosetItem, findClosetMatches, getClosetItems, type ClosetItem } from "../lib/closetStorage";
import { theme } from "../theme";
import { IDLE_STATE, type LoadState } from "./results/types";
import { OverviewTab } from "./results/OverviewTab";
import { PriceComparisonTab } from "./results/PriceComparisonTab";
import { ReviewsTab } from "./results/ReviewsTab";
import { SimilarItemsTab } from "./results/SimilarItemsTab";
import { OutfitMatchesTab } from "./results/OutfitMatchesTab";

// This screen is a thin shell: item selector + tab bar + save/scan-again
// actions, all state/fetch logic for the per-item pricing/outfit caches, and
// tab content delegated to app/screens/results/*Tab.tsx. Split out of a single
// 559-line file (see git history) so each tab's render logic can change
// independently without re-reviewing the other four every time.

type Props = NativeStackScreenProps<RootStackParamList, "Results">;

const TABS = ["Overview", "Price Comparison", "Reviews", "Similar Items", "Outfit Matches"] as const;
type Tab = (typeof TABS)[number];

export function ResultsScreen({ route, navigation }: Props) {
  const { classifications, initialIndex = 0, prefetchedPricing, prefetchedOutfits, photoThumbnail } = route.params;
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [tab, setTab] = useState<Tab>("Overview");
  const classification = classifications[selectedIndex];

  // Per-item caches, keyed by index into `classifications` — one detected item's
  // pricing/outfit fetch never affects another's. Only `initialIndex` is
  // prefetched eagerly (see the mount-only effect below); every other item's data
  // is fetched lazily, the first time the user actually selects it — deliberate,
  // not an oversight: eagerly prefetching every detected item would multiply
  // SerpApi calls by however many items are in the photo, against a tight shared
  // monthly quota (see prefetchResultsData's doc comment).
  const [pricingByIndex, setPricingByIndex] = useState<Record<number, LoadState<PriceSearchResult>>>({});
  const [outfitsByIndex, setOutfitsByIndex] = useState<Record<number, LoadState<OutfitSuggestionsResult>>>({});
  const [closetSaveStateByIndex, setClosetSaveStateByIndex] = useState<Record<number, "idle" | "saving" | "saved">>({});

  const pricingState = pricingByIndex[selectedIndex] ?? IDLE_STATE;
  const outfitsState = outfitsByIndex[selectedIndex] ?? IDLE_STATE;
  const closetSaveState = closetSaveStateByIndex[selectedIndex] ?? "idle";

  const fetchPricing = useCallback(async (index: number) => {
    setPricingByIndex((prev) => ({ ...prev, [index]: { data: null, loading: true, error: null } }));
    try {
      const result = await searchPrices(classifications[index]);
      setPricingByIndex((prev) => ({ ...prev, [index]: { data: result, loading: false, error: null } }));
    } catch (err) {
      setPricingByIndex((prev) => ({
        ...prev,
        [index]: { data: null, loading: false, error: toErrorInfo(err, "Couldn't load pricing") },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchOutfits = useCallback(async (index: number) => {
    setOutfitsByIndex((prev) => ({ ...prev, [index]: { data: null, loading: true, error: null } }));
    try {
      const result = await getOutfitSuggestions(classifications[index]);
      setOutfitsByIndex((prev) => ({ ...prev, [index]: { data: result, loading: false, error: null } }));
    } catch (err) {
      setOutfitsByIndex((prev) => ({
        ...prev,
        [index]: { data: null, loading: false, error: toErrorInfo(err, "Couldn't load outfit ideas") },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Mount-only, eager, for initialIndex only — prefers an already-in-flight
    // prefetched request (see prefetchResultsData in app/lib/prefetchResults.ts)
    // over starting a fresh one, falling back to fetchPricing/fetchOutfits when
    // nothing was prefetched (e.g. hot-reloaded straight onto this screen).
    if (prefetchedPricing) {
      setPricingByIndex((prev) => ({ ...prev, [initialIndex]: { data: null, loading: true, error: null } }));
      prefetchedPricing
        .then((result) => setPricingByIndex((prev) => ({ ...prev, [initialIndex]: { data: result, loading: false, error: null } })))
        .catch((err) =>
          setPricingByIndex((prev) => ({
            ...prev,
            [initialIndex]: { data: null, loading: false, error: toErrorInfo(err, "Couldn't load pricing") },
          }))
        );
    } else {
      fetchPricing(initialIndex);
    }
    if (prefetchedOutfits) {
      setOutfitsByIndex((prev) => ({ ...prev, [initialIndex]: { data: null, loading: true, error: null } }));
      prefetchedOutfits
        .then((result) => setOutfitsByIndex((prev) => ({ ...prev, [initialIndex]: { data: result, loading: false, error: null } })))
        .catch((err) =>
          setOutfitsByIndex((prev) => ({
            ...prev,
            [initialIndex]: { data: null, loading: false, error: toErrorInfo(err, "Couldn't load outfit ideas") },
          }))
        );
    } else {
      fetchOutfits(initialIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Lazy fetch for whichever item the user just selected, only if it hasn't
    // been fetched (or isn't already in flight) yet — cached once loaded, so
    // switching back and forth between items never refetches.
    if (!(selectedIndex in pricingByIndex)) fetchPricing(selectedIndex);
    if (!(selectedIndex in outfitsByIndex)) fetchOutfits(selectedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  // For the Outfit Matches tab's "from your closet" section — a snapshot of
  // what's saved as of this screen loading, not kept live in sync with the
  // Closet screen. A scan is a single, short-lived view; re-reading storage
  // on every render (or subscribing to changes) would be effort spent on a
  // staleness window nobody will notice within one screen visit.
  const [closetItems, setClosetItems] = useState<ClosetItem[]>([]);
  useEffect(() => {
    getClosetItems()
      .then(setClosetItems)
      .catch((err) => console.warn("[ResultsScreen] Failed to load closet:", err));
  }, []);

  const closetMatches = useMemo(() => {
    const outfits = outfitsState.data;
    if (!outfits || outfits.suggestions.length === 0 || closetItems.length === 0) return [];
    const seen = new Set<string>();
    const matches: ClosetItem[] = [];
    for (const suggestion of outfits.suggestions) {
      for (const match of findClosetMatches(closetItems, suggestion.keywords, 3)) {
        if (!seen.has(match.id)) {
          seen.add(match.id);
          matches.push(match);
        }
      }
    }
    return matches.slice(0, 6);
  }, [outfitsState.data, closetItems]);

  const handleSaveToCloset = useCallback(async () => {
    if (closetSaveState !== "idle") return;
    setClosetSaveStateByIndex((prev) => ({ ...prev, [selectedIndex]: "saving" }));
    try {
      await addClosetItem(classification, pricingState.data?.estimatedNewRange, photoThumbnail);
      setClosetSaveStateByIndex((prev) => ({ ...prev, [selectedIndex]: "saved" }));
    } catch (err) {
      console.warn("[ResultsScreen] Failed to save to closet:", err);
      setClosetSaveStateByIndex((prev) => ({ ...prev, [selectedIndex]: "idle" }));
    }
  }, [classification, pricingState.data, closetSaveState, photoThumbnail, selectedIndex]);

  return (
    <View style={styles.container}>
      {classifications.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.itemSelectorBar}
          contentContainerStyle={styles.itemSelectorContent}
        >
          {classifications.map((c, i) => (
            <Pressable
              key={i}
              onPress={() => setSelectedIndex(i)}
              style={[styles.itemChip, i === selectedIndex && styles.itemChipActive]}
              accessibilityRole="tab"
              accessibilityLabel={c.garmentType}
              accessibilityState={{ selected: i === selectedIndex }}
            >
              <Text style={[styles.itemChipText, i === selectedIndex && styles.itemChipTextActive]}>{c.garmentType}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabButton, tab === t && styles.tabButtonActive]}
            accessibilityRole="tab"
            accessibilityLabel={t}
            accessibilityState={{ selected: tab === t }}
          >
            <Text style={[styles.tabButtonText, tab === t && styles.tabButtonTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: theme.spacing.md }}>
        {tab === "Overview" && (
          <OverviewTab
            classification={classification}
            classifications={classifications}
            selectedIndex={selectedIndex}
            photoThumbnail={photoThumbnail}
            pricing={pricingState.data}
            pricingLoading={pricingState.loading}
            navigation={navigation}
          />
        )}

        {tab === "Price Comparison" && (
          <PriceComparisonTab
            pricing={pricingState.data}
            loading={pricingState.loading}
            error={pricingState.error}
            onRetry={() => fetchPricing(selectedIndex)}
          />
        )}

        {tab === "Reviews" && (
          <ReviewsTab
            pricing={pricingState.data}
            loading={pricingState.loading}
            error={pricingState.error}
            onRetry={() => fetchPricing(selectedIndex)}
          />
        )}

        {tab === "Similar Items" && (
          <SimilarItemsTab
            pricing={pricingState.data}
            loading={pricingState.loading}
            error={pricingState.error}
            onRetry={() => fetchPricing(selectedIndex)}
          />
        )}

        {tab === "Outfit Matches" && (
          <OutfitMatchesTab
            outfits={outfitsState.data}
            loading={outfitsState.loading}
            error={outfitsState.error}
            onRetry={() => fetchOutfits(selectedIndex)}
            closetMatches={closetMatches}
          />
        )}
      </ScrollView>

      <Pressable
        style={[styles.saveClosetButton, closetSaveState !== "idle" && styles.saveClosetButtonDone]}
        onPress={handleSaveToCloset}
        disabled={closetSaveState !== "idle"}
        accessibilityRole="button"
        accessibilityLabel={closetSaveState === "saved" ? "Saved to closet" : "Save to closet"}
        accessibilityState={{ disabled: closetSaveState !== "idle" }}
      >
        <Text style={styles.saveClosetText}>
          {closetSaveState === "saved" ? "Saved to Closet ✓" : closetSaveState === "saving" ? "Saving…" : "Save to Closet"}
        </Text>
      </Pressable>

      <Pressable
        style={styles.scanAgainButton}
        onPress={() => navigation.popToTop()}
        accessibilityRole="button"
        accessibilityLabel="Scan another item"
      >
        <Text style={styles.scanAgainText}>Scan another item</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  // Item selector — only rendered when a scan detected more than one item (see
  // classifications.length > 1 above). Mirrors the tab bar's own pill styling
  // directly below rather than inventing new visual language for it.
  itemSelectorBar: { maxHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  itemSelectorContent: { paddingHorizontal: 12, paddingVertical: 8, alignItems: "center", gap: 8 },
  itemChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceAlt },
  itemChipActive: { backgroundColor: theme.colors.accent },
  itemChipText: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.semiBold },
  itemChipTextActive: { color: theme.colors.textPrimary },
  tabBar: { maxHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  tabBarContent: { paddingHorizontal: 12, alignItems: "center", gap: 8 },
  tabButton: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.pill },
  tabButtonActive: { backgroundColor: theme.colors.glow(0.18) },
  tabButtonText: { color: theme.colors.textSecondary, fontSize: 13, fontFamily: theme.fonts.body.semiBold },
  tabButtonTextActive: { color: theme.colors.textPrimary },
  content: { flex: 1 },
  scanAgainButton: { marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.md, backgroundColor: theme.colors.accent, paddingVertical: 14, borderRadius: theme.radius.md, alignItems: "center" },
  scanAgainText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.bold },
  saveClosetButton: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  saveClosetButtonDone: { opacity: 0.6 },
  saveClosetText: { color: theme.colors.textPrimary, fontSize: 16, fontFamily: theme.fonts.body.semiBold },
});
