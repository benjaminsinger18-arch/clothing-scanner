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
const SONNET_MODEL = "claude-sonnet-5";
const CLASSIFY_TOOL_NAME = "report_classification";

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

function needsEscalation(result: RawClassification): boolean {
  if (result.garmentType === UNRECOGNIZED_GARMENT) return false; // a stronger model won't fix a bad photo
  return result.brandConfidence === "low";
}

/**
 * Classifies a garment photo. Defaults to Haiku (cheap/fast); escalates to a
 * second Sonnet call when the Haiku result reports low brand confidence on an
 * otherwise-recognized item. Retries each model once on transient failure;
 * throws ClassificationError only if the (retried) Haiku call fails outright,
 * since nothing downstream can proceed without a base classification.
 */
export async function classifyImage(opts: ClassifyOptions): Promise<ClassificationResult> {
  const haikuResult = await callClaudeWithRetry(HAIKU_MODEL, opts);

  if (!needsEscalation(haikuResult)) {
    return { ...haikuResult, model: "claude-haiku-4-5" };
  }

  try {
    const sonnetResult = await callClaudeWithRetry(SONNET_MODEL, opts);
    return { ...sonnetResult, model: "claude-sonnet-5" };
  } catch (err) {
    console.error("[claudeClient] Sonnet escalation failed, falling back to Haiku result:", err);
    return { ...haikuResult, model: "claude-haiku-4-5" };
  }
}
