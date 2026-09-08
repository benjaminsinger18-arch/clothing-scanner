import { View } from "react-native";
import type { PriceSearchResult } from "@clothing-scanner/shared-types";
import { PriceRangeSummary } from "./PriceRangeSummary";
import { ProviderDataBody } from "./ProviderDataBody";
import type { ErrorInfo } from "./types";

export function PriceComparisonTab({
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
      <PriceRangeSummary pricing={pricing} loading={loading} />
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
