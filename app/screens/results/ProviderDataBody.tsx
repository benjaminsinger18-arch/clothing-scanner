import { ActivityIndicator } from "react-native";
import type { DataSourceStatus, PriceListing } from "@clothing-scanner/shared-types";
import { ItemCard } from "../../components/ItemCard";
import { ErrorState } from "../../components/ErrorState";
import { theme } from "../../theme";
import type { ErrorInfo } from "./types";

/** Shared renderer for any tab backed by a PriceListing[] slice of the /price-search
 * response (Price Comparison, Similar Items, Reviews). `status` covers provider-level
 * failures (rate limited / unavailable); an empty `items` array under an otherwise-ok
 * status is treated as "nothing found for this particular tab" rather than an error. */
export function ProviderDataBody({
  items,
  status,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDetail,
}: {
  items: PriceListing[];
  status: DataSourceStatus | null;
  loading: boolean;
  error: ErrorInfo | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (loading) {
    return <ActivityIndicator color={theme.colors.textPrimary} style={{ marginTop: 24 }} />;
  }
  if (error) {
    return <ErrorState title={error.title} detail={error.detail} onRetry={onRetry} />;
  }
  if (status === "unavailable" || status === null) {
    return (
      <ErrorState
        title="Couldn't load pricing right now"
        detail="Give it another moment and try again."
        onRetry={onRetry}
      />
    );
  }
  if (status === "rate_limited") {
    return <ErrorState title="We've hit today's limit" detail="Try again a little later." onRetry={onRetry} />;
  }
  if (items.length === 0) {
    return <ErrorState title={emptyTitle} detail={emptyDetail} onRetry={onRetry} />;
  }
  return (
    <>
      {items.map((item, i) => (
        <ItemCard key={i} item={item} />
      ))}
    </>
  );
}
