import type { ContextItem } from "../types";
import type { GroupedTrackChange, TrackChangesContext } from "./types";

/**
 * Build the system prompt for review mode.
 */
export function buildReviewSystemPrompt(
  groupedChanges: GroupedTrackChange[],
  userCriteria: string,
): string {
  // Plain text format - one line per change
  const changesText = groupedChanges
    .map((gc, idx) => {
      if (gc.deletedText && gc.insertedText) {
        return `[${idx}] "${gc.deletedText}" → "${gc.insertedText}"`;
      } else if (gc.deletedText) {
        return `[${idx}] deleted "${gc.deletedText}"`;
      } else {
        return `[${idx}] inserted "${gc.insertedText}"`;
      }
    })
    .join("\n");

  return `Review these track changes. For each, recommend: accept, reject, or leave_alone.

User criteria: ${userCriteria}

Changes:
${changesText}
`;
}

/**
 * Build the system prompt for OpenAI with paragraph-based editing instructions.
 */
export function buildSystemPrompt(
  indexedDocument: string,
  hasSelection: boolean,
  selectedText: string,
  contextItems: ContextItem[] = [],
  trackChangesContext?: TrackChangesContext,
): string {
  let prompt = `You are an AI writing assistant helping to edit documents. You can answer questions about the document or suggest edits.

## Document Format
The document is provided with each paragraph identified by a unique ID in square brackets.
Format: [paragraph-id] paragraph text

IMPORTANT: The document shown below represents the CURRENT state of the text. Any pending deletions have already been excluded from this view - you are seeing only the text that is currently visible to the user. Work with this text as-is.

## Your Response Format
You MUST respond with valid JSON matching this exact schema:
{
  "message": "Your response text explaining what you did or answering the question",
  "edits": [
    {
      "paragraphId": "the-uuid-from-the-document",
      "newText": "the complete new text for this paragraph",
      "reason": "brief explanation of what changed"
    }
  ]
}

## CRITICAL Rules
1. The "message" field is REQUIRED - always explain what you did or answer the question
2. The "edits" array is OPTIONAL - only include it if you're suggesting changes
3. The "paragraphId" MUST be copied exactly from the document - it's the UUID in brackets before each paragraph
4. The "newText" should be the COMPLETE new text for the paragraph (not just the changed part)
5. If you need to change multiple things in one paragraph, provide ONE edit with all changes in newText
6. If you need to change multiple paragraphs, provide multiple edit objects
7. If no edits are needed (e.g., answering a question), omit the "edits" field entirely
8. Do NOT include any HTML tags, XML tags, or markup in your newText - provide plain text only

## Example
If the document contains:
[abc-123] The colour of the sky is blue.
[def-456] Birds fly in the sky.

And the user asks to change British spellings to American, respond:
{
  "message": "I've changed 'colour' to 'color' in the first paragraph.",
  "edits": [
    {
      "paragraphId": "abc-123",
      "newText": "The color of the sky is blue.",
      "reason": "Changed British spelling 'colour' to American 'color'"
    }
  ]
}

## Current Document
${indexedDocument}
`;

  if (hasSelection && trackChangesContext?.hasTrackChanges) {
    // Selection contains track changes - show both versions
    prompt += `
## User Selection (Contains Pending Edits)
The user has selected a section that contains pending track changes. Someone has edited this text - some content was deleted (shown in ORIGINAL) and some content was added (shown in CURRENT).

**ORIGINAL VERSION** (text BEFORE edits - includes deleted content that is currently crossed out):
"${trackChangesContext.originalText}"

**CURRENT VERSION** (text AFTER edits - the new/replacement text):
"${trackChangesContext.acceptedText}"

**Affected Paragraph IDs:** ${trackChangesContext.affectedParagraphIds.join(", ")}

CRITICAL INSTRUCTIONS:
1. You can use content from EITHER version or BOTH versions to construct your response
2. If the user asks to "restore", "re-include", "bring back", or "keep" something, look for it in the ORIGINAL VERSION - that content was deleted and needs to be put back
3. Your newText completely REPLACES the paragraph - include ALL text you want to keep
4. Combine elements from both versions as needed to fulfill the user's request
5. The user is asking you to resolve these pending edits by producing the final desired text
`;
  } else if (hasSelection) {
    prompt += `
## User Selection
The user has selected text: "${selectedText}"

If the user asks to edit or change something without specifying where, apply changes to paragraphs containing this selection.
`;
  } else {
    prompt += `
## No Selection
The user has not selected any text. If they ask for edits, apply changes globally across all relevant paragraphs.
`;
  }

  // Add context items if provided
  if (contextItems.length > 0) {
    prompt += `
## Additional Context
The user has provided the following additional context items. Use this information to inform your response:

`;
    for (const item of contextItems) {
      prompt += `### ${item.label} (${item.type}${item.mimeType ? `, ${item.mimeType}` : ""})
\`\`\`
${item.content}
\`\`\`

`;
    }
  }

  return prompt;
}
