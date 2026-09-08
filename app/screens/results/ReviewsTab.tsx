import { View } from "react-native";
import type { PriceSearchResult } from "@clothing-scanner/shared-types";
import { ProviderDataBody } from "./ProviderDataBody";
import type { ErrorInfo } from "./types";

export function ReviewsTab({
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
        items={pricing?.reviews ?? []}
        status={pricing?.status ?? null}
        loading={loading}
        error={error}
        onRetry={onRetry}
        emptyTitle="No reviews found for this item"
        emptyDetail="This is common for less popular or secondhand items."
      />
    </View>
  );
}
