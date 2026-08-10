// Wraps the Claude Messages API for garment classification. Uses tool-forced
// structured output (rather than parsing free text) so the response always
// matches ClassificationResult's shape.

import Anthropic from "@anthropic-ai/sdk";
import {
  UNRECOGNIZED_GARMENT,
  type BrandConfidence,
  type ClassificationResult,
} from "@clothing-scanner/shared-types";
import type { SupportedMediaType } from "../lib/imageUtils.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const CLASSIFY_TOOL_NAME = "report_classification";
const OUTFIT_TOOL_NAME = "report_outfit_suggestions";

export class ClassificationError extends Error {}

let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ClassificationError(
        "ANTHROPIC_API_KEY is not set — copy server/.env.example to server/.env and fill it in"
      );
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const classifyTool: Anthropic.Tool = {
  name: CLASSIFY_TOOL_NAME,
  description: "Report the structured classification of a piece of clothing shown in a photo.",
  input_schema: {
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
        description: 'Broad category, e.g. "outerwear", "tops", "bottoms", "footwear", "accessories".',
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
  },
};

interface RawClassification {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

interface ClassifyOptions {
  imageBase64: string;
  mediaType: SupportedMediaType;
}

async function callClaude(model: string, opts: ClassifyOptions): Promise<RawClassification> {
  const response = await getClient().messages.create({
    model,
    max_tokens: 512,
    tools: [classifyTool],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: opts.mediaType, data: opts.imageBase64 } },
          {
            type: "text",
            text:
              "Identify the piece of clothing in this photo and call report_classification with your " +
              "best assessment. Be honest about uncertainty — do not guess a brand you can't reasonably " +
              "support from visible evidence.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === CLASSIFY_TOOL_NAME
  );
  if (!toolUse) {
    throw new ClassificationError("Claude did not return a structured classification");
  }
  return toolUse.input as RawClassification;
}

async function callClaudeWithRetry(model: string, opts: ClassifyOptions): Promise<RawClassification> {
  try {
    return await callClaude(model, opts);
  } catch (err) {
    console.warn(`[claudeClient] ${model} call failed, retrying once:`, err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callClaude(model, opts);
  }
}

/**
 * Classifies a garment photo using Haiku (cheap/fast). Retries once on
 * transient failure; throws ClassificationError if the retried call also
 * fails, since nothing downstream can proceed without a base classification.
 *
 * Previously escalated to a second, sequential Sonnet call whenever brand
 * confidence came back "low" on a recognized item, to try for a better brand
 * guess. Dropped: it doubled classify latency on a large share of scans, and
 * the UI already renders "low" confidence as a normal, fully-supported result
 * (see ResultsScreen's brand-guess hint) — the accuracy trade wasn't worth
 * the wait.
 */
export async function classifyImage(opts: ClassifyOptions): Promise<ClassificationResult> {
  const result = await callClaudeWithRetry(HAIKU_MODEL, opts);
  return { ...result, model: "claude-haiku-4-5" };
}

const outfitTool: Anthropic.Tool = {
  name: OUTFIT_TOOL_NAME,
  description: "Report 3-5 complementary clothing items that would pair well with the given item as an outfit.",
  input_schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description:
                'Short, search-friendly keyword phrase for the complementary item, e.g. "navy chino pants" ' +
                'or "white leather sneakers" — not a full sentence, and not a restatement of the item itself.',
            },
          },
          required: ["keywords"],
        },
      },
    },
    required: ["suggestions"],
  },
};

export interface OutfitPairingInput {
  garmentType: string;
  category: string;
  color: string;
  pattern: string;
  style: string;
  brandGuess: string | null;
  brandConfidence: BrandConfidence;
}

function describeItem(input: OutfitPairingInput): string {
  const brandPart =
    input.brandGuess && (input.brandConfidence === "medium" || input.brandConfidence === "high")
      ? ` (possibly ${input.brandGuess})`
      : "";
  const patternPart = input.pattern && input.pattern.toLowerCase() !== "none" ? `${input.pattern} ` : "";
  return `${input.color} ${patternPart}${input.garmentType}${brandPart}, style: ${input.style}, category: ${input.category}`;
}

async function callOutfitSuggestions(input: OutfitPairingInput): Promise<string[]> {
  const response = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    tools: [outfitTool],
    tool_choice: { type: "tool", name: OUTFIT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content:
          `Suggest 3-5 clothing items that would pair well as an outfit with this item: ${describeItem(input)}. ` +
          "Call report_outfit_suggestions with short, search-friendly keyword phrases suitable for a product search.",
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === OUTFIT_TOOL_NAME
  );
  if (!toolUse) {
    throw new ClassificationError("Claude did not return outfit suggestions");
  }

  const result = toolUse.input as { suggestions: { keywords: string }[] };
  return result.suggestions.map((s) => s.keywords).filter(Boolean);
}

/** Suggests 3-5 search-ready keyword phrases for items that would complement the
 * given garment. Text-only (no image), so it's cheap — always uses Haiku. Retries
 * once on transient failure; throws on a second failure, since the outfit-suggestions
 * endpoint has nothing useful to return without this. */
export async function suggestOutfitPairings(input: OutfitPairingInput): Promise<string[]> {
  try {
    return await callOutfitSuggestions(input);
  } catch (err) {
    console.warn("[claudeClient] outfit suggestion call failed, retrying once:", err);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await callOutfitSuggestions(input);
  }
}
