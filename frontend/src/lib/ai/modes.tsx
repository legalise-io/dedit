import type {
  AIMode,
  AIEditorConfig,
  AIReviewRequest,
  AIEditRequest,
  ModeContext,
  ModeResult,
} from "./types";
import { buildSystemPrompt, buildReviewSystemPrompt } from "./prompts";
import { REVIEW_RESPONSE_SCHEMA, EDIT_RESPONSE_SCHEMA } from "./schemas";

// ============================================================================
// Built-in Mode Icons
// ============================================================================

export const ReviewIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

// ============================================================================
// Handler Dependencies
// ============================================================================

export interface HandlerDependencies {
  config: AIEditorConfig;
  apiKey: string | null;
}

// ============================================================================
// Review Mode Handler Factory
// ============================================================================

/**
 * Create the review mode handler.
 * Uses config.onAIReviewRequest if provided, otherwise calls OpenAI directly.
 */
export function createReviewModeHandler(
  deps: HandlerDependencies,
): (context: ModeContext) => Promise<ModeResult> {
  return async (context: ModeContext): Promise<ModeResult> => {
    const { config, apiKey } = deps;
    const { prompt, groupedChanges } = context;

    // Build the system prompt for review
    const systemPrompt = buildReviewSystemPrompt(groupedChanges, prompt);

    if (config.onAIReviewRequest) {
      // Use custom handler
      console.log("[reviewMode] Using custom onAIReviewRequest handler");

      const request: AIReviewRequest = {
        prompt,
        changes: groupedChanges.map((gc, idx) => ({
          index: idx,
          deletedText: gc.deletedText,
          insertedText: gc.insertedText,
          author: gc.author,
        })),
      };

      const response = await config.onAIReviewRequest(request);
      return {
        message: response.message,
        recommendations: response.recommendations,
      };
    }

    // Direct OpenAI API mode
    console.log("[reviewMode] Using direct OpenAI API");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel || "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: config.aiTemperature ?? 1.0,
        max_completion_tokens: 65536,
        response_format: REVIEW_RESPONSE_SCHEMA,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `API request failed: ${response.status}`,
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    try {
      const parsed = JSON.parse(content);
      return {
        message: parsed.message || "",
        recommendations: parsed.recommendations || [],
      };
    } catch {
      return { message: content, recommendations: [] };
    }
  };
}

// ============================================================================
// Edit Mode Handler Factory
// ============================================================================

/**
 * Create the edit mode handler.
 * Uses config.onAIRequest if provided, otherwise calls OpenAI directly.
 */
export function createEditModeHandler(
  deps: HandlerDependencies,
): (context: ModeContext) => Promise<ModeResult> {
  return async (context: ModeContext): Promise<ModeResult> => {
    const { config, apiKey } = deps;
    const { prompt, paragraphs, selectedText, hasSelection, contextItems } =
      context;

    if (config.onAIRequest) {
      // Use custom handler
      console.log("[editMode] Using custom onAIRequest handler");

      const request: AIEditRequest = {
        prompt,
        paragraphs,
        selection: hasSelection
          ? { text: selectedText || "", hasSelection: true }
          : undefined,
        contextItems: contextItems.length > 0 ? contextItems : undefined,
      };

      const response = await config.onAIRequest(request);
      return {
        message: response.message,
        edits: response.edits.map((e) => ({
          paragraphId: e.paragraphId,
          newText: e.newText,
          reason: e.reason,
        })),
      };
    }

    // Direct OpenAI API mode - need to build the full document
    console.log("[editMode] Using direct OpenAI API");

    // Build indexed document string from paragraphs
    const indexedDocument = paragraphs
      .map((p) => `[${p.id}] ${p.text}`)
      .join("\n\n");

    const systemPrompt = buildSystemPrompt(
      indexedDocument,
      hasSelection,
      selectedText || "",
      contextItems,
      undefined, // trackChangesContext - would need to pass this through
    );

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel || "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: config.aiTemperature ?? 1.0,
        max_completion_tokens: 65536,
        response_format: EDIT_RESPONSE_SCHEMA,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `API request failed: ${response.status}`,
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    try {
      const parsed = JSON.parse(content);
      return {
        message: parsed.message || "",
        edits: parsed.edits || [],
      };
    } catch {
      return { message: content, edits: [] };
    }
  };
}

// ============================================================================
// Built-in Modes
// ============================================================================

/**
 * Create built-in modes with handlers wired to the given dependencies.
 */
export function createBuiltInModes(deps: HandlerDependencies): AIMode[] {
  return [
    {
      name: "review",
      description: "Review track changes and recommend accept/reject",
      icon: ReviewIcon,
      handler: createReviewModeHandler(deps),
    },
  ];
}

/**
 * Get all available modes, merging built-in with custom modes.
 * Custom modes with the same name override built-in ones.
 */
export function getAvailableModes(
  customModes: AIMode[] | undefined,
  deps: HandlerDependencies,
): AIMode[] {
  const builtIn = createBuiltInModes(deps);

  if (!customModes || customModes.length === 0) {
    return builtIn;
  }

  // Custom modes override built-in modes with the same name
  const customNames = new Set(customModes.map((m) => m.name));
  const filteredBuiltIn = builtIn.filter((m) => !customNames.has(m.name));

  return [...filteredBuiltIn, ...customModes];
}
