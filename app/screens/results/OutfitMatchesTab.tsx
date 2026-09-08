import { ActivityIndicator, Text, View } from "react-native";
import type { OutfitSuggestionsResult } from "@clothing-scanner/shared-types";
import { ItemCard } from "../../components/ItemCard";
import { ClosetItemCard } from "../../components/ClosetItemCard";
import { ErrorState } from "../../components/ErrorState";
import { theme } from "../../theme";
import type { ClosetItem } from "../../lib/closetStorage";
import { resultsStyles as styles } from "./styles";
import type { ErrorInfo } from "./types";

/** Renders the Outfit Matches tab: Claude-suggested keyword groups, each with real
 * listings underneath where available. Groups with zero items still show (so the
 * suggestion itself is visible) with a small inline note rather than being silently
 * dropped. */
export function OutfitMatchesTab({
  outfits,
  loading,
  error,
  onRetry,
  closetMatches,
}: {
  outfits: OutfitSuggestionsResult | null;
  loading: boolean;
  error: ErrorInfo | null;
  onRetry: () => void;
  closetMatches: ClosetItem[];
}) {
  if (loading) {
    return <ActivityIndicator color={theme.colors.textPrimary} style={{ marginTop: 24 }} />;
  }
  if (error) {
    return <ErrorState title={error.title} detail={error.detail} onRetry={onRetry} />;
  }
  if (!outfits || outfits.status === "unavailable") {
    return (
      <ErrorState
        title="Couldn't load outfit ideas right now"
        detail="Give it another moment and try again."
        onRetry={onRetry}
      />
    );
  }
  if (outfits.status === "rate_limited") {
    return <ErrorState title="We've hit today's limit" detail="Try again a little later." onRetry={onRetry} />;
  }
  if (outfits.suggestions.length === 0) {
    return (
      <ErrorState title="No outfit suggestions found" detail="Try again, or check back later." onRetry={onRetry} />
    );
  }
  return (
    <>
      {/* Closet-sourced matches are additive, not a replacement for the
          AI-guessed shoppable groups below — silently omitted (no empty
          state) when nothing in the closet matches, since an empty closet
          or a genuine no-match is the common case and not worth calling
          out as an error or gap. */}
      {closetMatches.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={styles.groupLabel}>From your closet</Text>
          {closetMatches.map((item) => (
            <ClosetItemCard key={item.id} item={item} />
          ))}
        </View>
      )}
      {outfits.suggestions.map((suggestion, i) => (
        <View key={i} style={{ marginBottom: 16 }}>
          <Text style={styles.groupLabel}>Pairs well with: {suggestion.keywords}</Text>
          {suggestion.items.length === 0 ? (
            <Text style={styles.note}>No matching items found right now.</Text>
          ) : (
            suggestion.items.map((item, j) => <ItemCard key={j} item={item} />)
          )}
        </View>
      ))}
    </>
  );
}
