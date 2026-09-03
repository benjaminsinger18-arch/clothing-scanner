// Single source of truth for the garment-classification output shape, shared
// between claudeClient.ts (as an Anthropic tool's input_schema) and
// geminiClient.ts (as a response_format.schema) so the two providers' structured
// outputs stay identical and directly comparable/mergeable in classifyImage.

import { UNRECOGNIZED_GARMENT, type BrandConfidence } from "@clothing-scanner/shared-types";

export const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    garmentType: {
      type: "string",
      description:
        `Specific garment type, e.g. "denim jacket", "graphic t-shirt", "chino pants". ` +
        `If the image does not clearly show a single wearable clothing item (wrong subject, ` +
        `too blurry/dark to tell), set this to exactly "${UNRECOGNIZED_GARMENT}".`,
    },
    category: {
      type: "string",
      enum: ["tops", "bottoms", "outerwear", "dresses", "footwear", "accessories", "activewear", "underwear-sleepwear"],
      description: "Broad category the garment belongs to — pick the single best fit.",
    },
    color: { type: "string", description: 'Dominant color(s), e.g. "navy blue".' },
    pattern: { type: "string", description: 'e.g. "solid", "striped", "floral", "plaid", "none".' },
    style: { type: "string", description: 'e.g. "casual", "formal", "streetwear", "vintage".' },
    brandGuess: {
      type: ["string", "null"],
      description:
        "Best-effort brand guess based on visible logos/labels/stitching/hardware. " +
        "Null if there is no reasonable basis for a guess.",
    },
    brandConfidence: {
      type: "string",
      enum: ["none", "low", "medium", "high"],
      description: "Your honest confidence in brandGuess — do not inflate this.",
    },
  },
  required: ["garmentType", "category", "color", "pattern", "style", "brandGuess", "brandConfidence"],
} as const;

/** The core identification instructions sent to whichever model is doing the
 * classifying — kept identical across providers so neither gets an easier/harder
 * framing of the same task, which would make their outputs harder to compare/merge
 * fairly. Provider-specific output-mechanism instructions (e.g. Claude's "call
 * report_classification") are prepended/appended by each client, not baked in here. */
export const CLASSIFICATION_PROMPT =
  "Look closely at the garment's cut, construction, and details before naming its " +
  "specific type, and judge its true dominant color as it actually appears in the " +
  "photo's lighting. Be honest about uncertainty — do not guess a brand you can't " +
  "reasonably support from visible evidence.";

export interface RawClassification {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}
