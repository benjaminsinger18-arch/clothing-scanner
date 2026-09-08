import { View } from "react-native";
import type { PriceSearchResult } from "@clothing-scanner/shared-types";
import { ProviderDataBody } from "./ProviderDataBody";
import type { ErrorInfo } from "./types";

// Deliberately renders the same `similarItems` slice as PriceComparisonTab —
// that duplication predates the ResultsScreen.tsx monolith breakup (both tabs
// already showed the identical listing set before this split) and is preserved
// here as-is rather than "fixed," since collapsing the two tabs would be a
// behavior change outside this refactor's scope.
export function SimilarItemsTab({
  pricing,
  loading,
  error,
  onRetry,
}: {
  pricing: PriceSearchResult | null;
  loading: boolean;
  error: ErrorInfo | null;
  onRetry: () => void;
}) {
  return (
    <View>
      <ProviderDataBody
        items={pricing?.similarItems ?? []}
        status={pricing?.status ?? null}
        loading={loading}
        error={error}
        onRetry={onRetry}
        emptyTitle="No similar listings found"
        emptyDetail="Try a clearer photo or a different angle."
      />
    </View>
  );
}
