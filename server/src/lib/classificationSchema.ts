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
