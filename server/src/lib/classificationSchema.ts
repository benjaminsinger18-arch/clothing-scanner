// Single source of truth for the garment-classification output shape, shared
// between claudeClient.ts (as an Anthropic tool's input_schema) and
// geminiClient.ts (as a response_format.schema) so the two providers' structured
// outputs stay identical and directly comparable/mergeable in classifyImage.

import { UNRECOGNIZED_GARMENT, type BrandConfidence, type Gender } from "@clothing-scanner/shared-types";

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
    gender: {
      type: "string",
      enum: ["men", "women", "unisex"],
      description:
        "Who this garment is styled/cut for. If a person is visible wearing it, base this on their " +
        "apparent gender presentation. Otherwise infer from the garment's cut, fit, and typical retail " +
        'styling/marketing (e.g. a fitted blouse with darts reads "women", a boxy suit jacket with a ' +
        'masculine cut reads "men"). Use "unisex" only when the item is genuinely gender-neutral in ' +
        'styling (e.g. a plain crewneck sweatshirt, a basic tote bag) — not as a default when you\'re ' +
        'simply unsure; make your best call between "men" and "women" whenever the styling gives any ' +
        "signal at all.",
    },
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
  required: ["garmentType", "category", "color", "pattern", "style", "gender", "brandGuess", "brandConfidence"],
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
  "reasonably support from visible evidence. Also note who the item is styled/cut " +
  "for (men, women, or unisex) — this drives gendered outfit-pairing suggestions " +
  "downstream, so give it real consideration rather than defaulting to unisex.";

export interface RawClassification {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  gender: Gender;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

// --- Multi-item extension ---------------------------------------------------
// Used only by the main photo-scan path (classifyImage in claudeClient.ts) via a
// second tool, report_clothing_items — classifyFromBarcode and the correction
// flow's structuring call keep using CLASSIFICATION_JSON_SCHEMA/classifyTool
// above completely untouched, since a barcode match or a user's typed correction
// is always genuinely one item, never several.
//
// Per-field shape (color/pattern/style/gender/brandGuess/brandConfidence) is
// identical to the single-item schema, so it's spread in rather than redefined —
// only garmentType/category get multi-item-aware wording. category.enum is
// reused BY REFERENCE (not copied), so fashionClipClient.ts's startup check
// against CLASSIFICATION_JSON_SCHEMA.properties.category.enum can never drift
// out of sync with what this schema accepts.
const MULTI_ITEM_ITEM_SCHEMA = {
  type: "object",
  properties: {
    ...CLASSIFICATION_JSON_SCHEMA.properties,
    garmentType: {
      type: "string",
      description:
        `Specific garment type, e.g. "denim jacket", "graphic t-shirt", "chino pants". This is one ` +
        `of possibly several distinct wearable items visible in the photo — describe just this one item.`,
    },
    category: {
      type: "string",
      enum: CLASSIFICATION_JSON_SCHEMA.properties.category.enum,
      description: "Broad category this specific item belongs to — pick the single best fit for this item.",
    },
  },
  required: CLASSIFICATION_JSON_SCHEMA.required,
} as const;

export const MULTI_ITEM_TOOL_NAME = "report_clothing_items";

export const MULTI_ITEM_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description:
        "One entry per distinct, clearly visible wearable clothing item in the photo (top, bottoms, " +
        "outerwear/jacket, dress, footwear, hat/bag-type accessory, activewear, or underwear/sleepwear " +
        "item), including layered items worn together — list a jacket AND the shirt visible underneath " +
        "it as two separate entries when both are visible. List the single most visually prominent/" +
        "primary item of the outfit FIRST, then the rest in any reasonable order. Do NOT include belts " +
        "or jewelry (rings, necklaces, bracelets, watches, earrings) as entries, even if clearly visible " +
        "— skip those specifically; they should never appear in this list. If nothing recognizable and " +
        "wearable is visible in the photo at all, return an empty array.",
      items: MULTI_ITEM_ITEM_SCHEMA,
    },
  },
  required: ["items"],
} as const;

/** Same core instructions as CLASSIFICATION_PROMPT, plus the one addition that
 * actually matters for multi-item: look for every distinct garment, not just the
 * most prominent one. Kept as an extension rather than a rewrite so the two
 * prompts can't drift apart on the shared guidance (color judgment, brand
 * honesty, gender consideration) that applies identically either way. */
export const MULTI_ITEM_PROMPT =
  CLASSIFICATION_PROMPT +
  " This photo may show a whole outfit rather than a single item — look for every distinct wearable " +
  "garment visible and report each as its own entry (see report_clothing_items' schema for exactly " +
  "what to include/exclude).";

export interface RawMultiItemClassification {
  items: RawClassification[];
}
