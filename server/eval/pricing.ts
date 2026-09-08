// Rough, hand-maintained USD-per-token pricing for the cost estimates in
// runEval.ts and summarizeClassifications.ts. NOT wired to any live pricing
// API — these numbers can drift from Anthropic's/Google's actual published
// rates over time (check their pricing pages if a number here looks stale).
// Good enough for "is this rescue path meaningfully more expensive than the
// common path," not for reconciling an actual invoice.

export interface TokenPrice {
  /** USD per 1,000,000 input tokens. */
  input: number;
  /** USD per 1,000,000 output tokens. */
  output: number;
}

// classifyImage (claudeClient.ts) always uses Sonnet for its Claude calls;
// classifyFromBarcode/suggestOutfitPairings/correction-structuring use Haiku
// — kept here in case a future cost breakdown wants to include those too.
export const CLAUDE_SONNET_PRICE: TokenPrice = { input: 3, output: 15 };
export const CLAUDE_HAIKU_PRICE: TokenPrice = { input: 1, output: 5 };
// Matches geminiClient.ts's own cost-note comment (~$2/M input, ~$12/M output
// "as of writing") — duplicated here rather than imported since that comment
// is prose, not an exported constant, and this is an estimate either way.
export const GEMINI_PRICE: TokenPrice = { input: 2, output: 12 };

export function estimateCostUsd(inputTokens: number, outputTokens: number, price: TokenPrice): number {
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export function formatUsd(amount: number): string {
  // Sub-cent precision matters here — a single scan is a fraction of a cent,
  // and "$0.00" for every line would defeat the point of showing this at all.
  return `$${amount.toFixed(4)}`;
}
