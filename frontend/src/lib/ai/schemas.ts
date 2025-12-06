/**
 * OpenAI Response Schemas (for direct API mode)
 * These use JSON Schema format for structured outputs
 */

export const REVIEW_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "ai_review_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Summary of the review",
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: {
                type: "number",
                description: "Index of the change being evaluated",
              },
              recommendation: {
                type: "string",
                enum: ["accept", "reject", "leave_alone"],
                description: "The recommended action",
              },
              reason: {
                type: "string",
                description: "Brief explanation for this recommendation",
              },
            },
            required: ["index", "recommendation", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["message", "recommendations"],
      additionalProperties: false,
    },
  },
};

export const EDIT_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "ai_edit_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Response message explaining what was done",
        },
        edits: {
          type: "array",
          description: "Array of paragraph edits (empty if no changes needed)",
          items: {
            type: "object",
            properties: {
              paragraphId: {
                type: "string",
                description: "The UUID of the paragraph to edit",
              },
              newText: {
                type: "string",
                description: "The complete new text for the paragraph",
              },
              reason: {
                type: "string",
                description: "Brief explanation of what was changed",
              },
            },
            required: ["paragraphId", "newText", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["message", "edits"],
      additionalProperties: false,
    },
  },
};
