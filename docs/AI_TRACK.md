# AI Track Changes Review Mode

> Design Document
> Created: 2024-12-06
> Status: Ready for Implementation

## Overview

This document describes the implementation of "Review Mode" - a feature that allows the AI to evaluate existing track changes and recommend whether to accept or reject each one based on user-provided criteria.

### Problem Statement

Users may receive documents with many track changes from reviewers, collaborators, or previous AI edits. Currently, they must manually review each change. The AI can help by evaluating changes against criteria like:

- "Accept grammar fixes, reject style changes"
- "Accept factual corrections, reject opinion changes"
- "Accept everything except changes to the legal section"

### Design Principles

1. **AI as Advisor**: The AI recommends actions; the user confirms
2. **Consistent UX**: Reuse existing AIChatPanel UI patterns
3. **Implicit Detection**: No special commands needed - AI detects intent from prompt
4. **Three Options**: Accept, Reject, or Leave Alone (user can always Discard a recommendation)

## User Flow

```
1. User has document with pending track changes
2. User enters prompt: "Accept grammar fixes, reject style changes"
3. AI detects review intent (prompt mentions accept/reject + pending changes exist)
4. AI evaluates each track change in scope (selection or full document)
5. AI returns recommendations with reasoning
6. Each recommendation appears in chat panel:
   - Shows the change: "old text → new text"
   - Shows AI recommendation: "Accept ✓" or "Reject ✗" with reason
   - Buttons: [Apply] [Discard]
7. User pages through:
   - Apply = execute the AI's recommendation
   - Discard = skip, leave track change pending
8. Done - discarded items simply remain as pending track changes
```

## Technical Design

### 1. New Types

```typescript
// In AIEditorContext.tsx or lib/types/index.ts

// AI's recommendation for an existing track change
export interface TrackChangeRecommendation {
  id: string;                          // Unique recommendation ID
  trackChangeId: string;               // ID of the track change being evaluated
  trackChangeType: "insertion" | "deletion";
  deletedText: string;                 // Original text (what was removed)
  insertedText: string;                // New text (what was added)
  recommendation: "accept" | "reject" | "leave_alone";
  reason: string;                      // AI's reasoning
  status: "pending" | "applied" | "discarded";
}

// Extended AI response for review mode
export interface AIReviewResponse {
  message: string;
  mode: "edit" | "review";             // Distinguishes response type
  recommendations?: TrackChangeRecommendation[];
}
```

### 2. Intent Detection

Add logic in `sendPrompt` to detect review intent:

```typescript
// In AIEditorContext.tsx

function detectReviewIntent(prompt: string, hasTrackChanges: boolean): boolean {
  if (!hasTrackChanges) return false;
  
  const reviewKeywords = [
    /\baccept\b/i,
    /\breject\b/i,
    /\breview\b/i,
    /\bkeep\b/i,
    /\brevert\b/i,
    /\bapprove\b/i,
    /\bdecline\b/i,
    /\bundo\b/i,
  ];
  
  return reviewKeywords.some(pattern => pattern.test(prompt));
}
```

### 3. Gathering Track Changes for AI

Add function to collect pending track changes in scope:

```typescript
// In AIEditorContext.tsx

interface PendingTrackChange {
  id: string;
  type: "insertion" | "deletion";
  text: string;
  author: string | null;
  date: string | null;
  paragraphId: string;
  // For context: surrounding text
  before: string;  // ~20 chars before
  after: string;   // ~20 chars after
}

function getPendingTrackChangesInScope(
  editor: Editor,
  from: number,
  to: number
): PendingTrackChange[] {
  const changes: PendingTrackChange[] = [];
  const doc = editor.state.doc;
  
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "paragraph") {
      const paragraphId = node.attrs.id;
      
      node.descendants((child, childPos) => {
        if (child.isText && child.text) {
          for (const mark of child.marks) {
            if (mark.type.name === "insertion" || mark.type.name === "deletion") {
              const absolutePos = pos + 1 + childPos;
              
              // Get surrounding context
              const before = doc.textBetween(
                Math.max(0, absolutePos - 20),
                absolutePos,
                " "
              );
              const after = doc.textBetween(
                absolutePos + child.text.length,
                Math.min(doc.content.size, absolutePos + child.text.length + 20),
                " "
              );
              
              changes.push({
                id: mark.attrs.id,
                type: mark.type.name as "insertion" | "deletion",
                text: child.text,
                author: mark.attrs.author,
                date: mark.attrs.date,
                paragraphId,
                before,
                after,
              });
            }
          }
        }
        return true;
      });
    }
    return true;
  });
  
  return changes;
}
```

### 4. Review Mode System Prompt

```typescript
function buildReviewSystemPrompt(
  trackChanges: PendingTrackChange[],
  userCriteria: string
): string {
  const changesJson = trackChanges.map(tc => ({
    id: tc.id,
    type: tc.type,
    text: tc.text,
    author: tc.author,
    context: `...${tc.before}[${tc.text}]${tc.after}...`
  }));
  
  return `You are an AI assistant helping to review track changes in a document.

## Your Task
Evaluate each pending track change and recommend whether to ACCEPT, REJECT, or LEAVE ALONE based on the user's criteria.

## User's Criteria
${userCriteria}

## Response Format
Respond with valid JSON matching this schema:
{
  "message": "Summary of your review",
  "mode": "review",
  "recommendations": [
    {
      "trackChangeId": "the-change-id",
      "recommendation": "accept" | "reject" | "leave_alone",
      "reason": "Brief explanation for this recommendation"
    }
  ]
}

## Guidelines
- "accept" = The change should be applied (deletion removes text, insertion keeps text)
- "reject" = The change should be reverted (deletion restores text, insertion removes text)  
- "leave_alone" = Uncertain or needs human judgment - skip this change
- Provide a clear, concise reason for each recommendation
- If a change doesn't match the user's criteria clearly, use "leave_alone"

## Pending Track Changes
${JSON.stringify(changesJson, null, 2)}
`;
}
```

### 5. Modified sendPrompt Flow

```typescript
// In sendPrompt function

const sendPrompt = useCallback(async (prompt: string) => {
  // ... existing setup ...
  
  // Check for pending track changes in scope
  const scopeFrom = hasSelection ? from : 0;
  const scopeTo = hasSelection ? to : ed.state.doc.content.size;
  const pendingChanges = getPendingTrackChangesInScope(ed, scopeFrom, scopeTo);
  
  // Detect if this is a review request
  const isReviewMode = detectReviewIntent(prompt, pendingChanges.length > 0);
  
  if (isReviewMode) {
    // Review mode: evaluate existing changes
    const systemPrompt = buildReviewSystemPrompt(pendingChanges, prompt);
    // ... make API call with review prompt ...
    // ... handle AIReviewResponse ...
  } else {
    // Edit mode: existing behavior
    // ... existing edit flow ...
  }
}, [/* deps */]);
```

### 6. Applying Recommendations

```typescript
// New function to apply a recommendation

const applyRecommendation = useCallback((rec: TrackChangeRecommendation) => {
  const ed = editorRef.current;
  if (!ed) return;
  
  if (rec.recommendation === "accept") {
    if (rec.trackChangeType === "insertion") {
      ed.commands.acceptInsertion(rec.trackChangeId);
    } else {
      ed.commands.acceptDeletion(rec.trackChangeId);
    }
  } else if (rec.recommendation === "reject") {
    if (rec.trackChangeType === "insertion") {
      ed.commands.rejectInsertion(rec.trackChangeId);
    } else {
      ed.commands.rejectDeletion(rec.trackChangeId);
    }
  }
  // "leave_alone" does nothing to the document
  
  updateRecommendationStatus(rec.id, "applied");
  
  // Auto-advance to next
  const nextRec = getNextRecommendation(rec);
  if (nextRec) {
    setTimeout(() => goToRecommendation(nextRec), 100);
  }
}, [/* deps */]);

const discardRecommendation = useCallback((rec: TrackChangeRecommendation) => {
  updateRecommendationStatus(rec.id, "discarded");
  
  // Auto-advance to next
  const nextRec = getNextRecommendation(rec);
  if (nextRec) {
    setTimeout(() => goToRecommendation(nextRec), 100);
  }
}, [/* deps */]);
```

### 7. UI Updates to AIChatPanel

The panel needs to handle both edit mode and review mode:

```tsx
// In AIChatPanel.tsx

const renderRecommendation = (rec: TrackChangeRecommendation, index: number) => {
  // Format: "old → new" for the change being evaluated
  let displayText: string;
  if (rec.deletedText && rec.insertedText) {
    displayText = `${truncate(rec.deletedText, 15)} → ${truncate(rec.insertedText, 15)}`;
  } else if (rec.deletedText) {
    displayText = `−${truncate(rec.deletedText, 30)}`;
  } else {
    displayText = `+${truncate(rec.insertedText, 30)}`;
  }
  
  const isResolved = rec.status === "applied" || rec.status === "discarded";
  
  // Recommendation badge styling
  const recBadgeClass = {
    accept: "rec-badge--accept",
    reject: "rec-badge--reject", 
    leave_alone: "rec-badge--neutral",
  }[rec.recommendation];
  
  const recLabel = {
    accept: "Accept ✓",
    reject: "Reject ✗",
    leave_alone: "Leave alone",
  }[rec.recommendation];
  
  return (
    <div
      key={rec.id}
      data-rec-id={rec.id}
      className={`rec-row rec-row--${rec.status}`}
    >
      {/* The change being reviewed */}
      <button
        type="button"
        className="rec-change-link"
        onClick={() => goToRecommendation(rec)}
        title={rec.reason}
      >
        <span className="rec-change-text">{displayText}</span>
      </button>
      
      {/* AI recommendation badge */}
      <span className={`rec-badge ${recBadgeClass}`}>
        {recLabel}
      </span>
      
      {/* Reason (collapsible or tooltip) */}
      <span className="rec-reason" title={rec.reason}>
        {truncate(rec.reason, 40)}
      </span>
      
      {/* Action buttons */}
      {!isResolved && (
        <div className="rec-actions">
          <button
            type="button"
            className="rec-apply-btn"
            onClick={(e) => { e.stopPropagation(); applyRecommendation(rec); }}
            title={`Apply: ${rec.recommendation} this change`}
          >
            Apply
          </button>
          <button
            type="button"
            className="rec-discard-btn"
            onClick={(e) => { e.stopPropagation(); discardRecommendation(rec); }}
            title="Skip this recommendation"
          >
            Discard
          </button>
        </div>
      )}
      
      {/* Status badges for resolved items */}
      {rec.status === "applied" && (
        <span className="rec-status-badge rec-status-applied">Applied</span>
      )}
      {rec.status === "discarded" && (
        <span className="rec-status-badge rec-status-discarded">Discarded</span>
      )}
    </div>
  );
};

// In renderMessage, check for recommendations
const renderMessage = (message: ChatMessage) => {
  const edits = message.metadata?.edits;
  const recommendations = message.metadata?.recommendations;
  
  // ... existing content rendering ...
  
  {recommendations && recommendations.length > 0 && (
    <div className="chat-message-recommendations">
      <div className="recs-header">
        Reviewed {recommendations.length} change{recommendations.length !== 1 ? "s" : ""}
      </div>
      <div className="recs-list">
        {recommendations.map((rec, index) => renderRecommendation(rec, index))}
      </div>
    </div>
  )}
};
```

### 8. CSS Additions

```css
/* Review mode recommendation styles */
.rec-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  margin-bottom: 4px;
}

.rec-row--applied {
  opacity: 0.6;
}

.rec-row--discarded {
  opacity: 0.4;
}

.rec-change-link {
  flex: 1;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-family: monospace;
  font-size: 12px;
}

.rec-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 3px;
}

.rec-badge--accept {
  background: #dcfce7;
  color: #166534;
}

.rec-badge--reject {
  background: #fee2e2;
  color: #991b1b;
}

.rec-badge--neutral {
  background: #f3f4f6;
  color: #6b7280;
}

.rec-reason {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
}

.rec-actions {
  display: flex;
  gap: 4px;
}

.rec-apply-btn,
.rec-discard-btn {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 3px;
  border: none;
  cursor: pointer;
}

.rec-apply-btn {
  background: var(--primary);
  color: white;
}

.rec-discard-btn {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
```

## Implementation Tasks

### Phase 1: Core Infrastructure
- [ ] Add `TrackChangeRecommendation` type to `lib/types/index.ts`
- [ ] Add `detectReviewIntent()` function to `AIEditorContext.tsx`
- [ ] Add `getPendingTrackChangesInScope()` function
- [ ] Add `buildReviewSystemPrompt()` function

### Phase 2: API Integration
- [ ] Extend `sendPrompt()` to detect and handle review mode
- [ ] Update OpenAI response schema for review mode
- [ ] Add `recommendations` field to `ChatMessage.metadata`

### Phase 3: State Management
- [ ] Add `applyRecommendation()` function
- [ ] Add `discardRecommendation()` function
- [ ] Add `getNextRecommendation()` navigation
- [ ] Add `updateRecommendationStatus()` function
- [ ] Wire up `goToRecommendation()` for scrolling/selection

### Phase 4: UI Updates
- [ ] Add `renderRecommendation()` to `AIChatPanel.tsx`
- [ ] Update `renderMessage()` to handle recommendations
- [ ] Add CSS styles for review mode UI
- [ ] Test Apply/Discard flow with auto-advance

### Phase 5: Testing & Polish
- [ ] Test with various review prompts
- [ ] Test with selection vs full document
- [ ] Test mixed scenarios (some accept, some reject, some leave alone)
- [ ] Test edge cases (no track changes, all same type, etc.)

## Design Decisions

1. **Paired Changes**: When a deletion and insertion are adjacent (replacement), present as one recommendation showing "old → new"

2. **Author Filtering**: Include author information in context sent to AI - user might say "accept John's changes, reject Mary's"

3. **Batch Operations**: No "Apply All" button - the value is in human review of AI recommendations

## Success Criteria

- User can enter review-intent prompts naturally without special syntax
- AI correctly identifies review mode vs edit mode
- Each recommendation shows the change, the AI's decision, and reasoning
- Apply executes the recommendation correctly
- Discard moves on without affecting the document
- Navigation between recommendations works smoothly
- UI is consistent with existing edit mode patterns
