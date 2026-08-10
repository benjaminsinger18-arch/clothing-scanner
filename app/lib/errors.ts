import { ApiError } from "../services/api";

export type ErrorInfo = { title: string; detail?: string };

/** Normalizes a caught fetch/API error into the {title, detail} shape every
 * screen renders via <ErrorState>. Shared so PreviewScreen's prefetch and
 * ResultsScreen's per-tab retries stay consistent. */
export function toErrorInfo(err: unknown, fallbackTitle: string): ErrorInfo {
  if (err instanceof ApiError) {
    return { title: err.message, detail: err.reason };
  }
  return { title: fallbackTitle };
}
