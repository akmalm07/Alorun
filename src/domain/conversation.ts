import type { ChatMessage, ChatTurn } from "../shared/contracts";

/** Voice session IDs are stable; repeated End/retry must not duplicate turns. */
export function mergeConversation(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const ids = new Set(current.map((message) => message.id));
  return [
    ...current,
    ...incoming.filter((message) => {
      if (ids.has(message.id)) return false;
      ids.add(message.id);
      return true;
    }),
  ];
}
export function recentConversation(messages: ChatTurn[]): ChatTurn[] {
  const selected: ChatTurn[] = [];
  let remaining = 12_000;
  for (const turn of messages.slice(-12).reverse()) {
    const content = turn.content.slice(0, Math.min(4000, remaining));
    if (!content) break;
    selected.unshift({ role: turn.role, content });
    remaining -= content.length;
  }
  return selected;
}

/** Preserve both drafts when dictation would overflow the editable message limit. */
export function combineDictation(
  current: string,
  dictated: string,
): { draft: string; conflict: string | null } {
  const combined = current ? `${current}\n${dictated}` : dictated;
  return combined.length <= 4000
    ? { draft: combined, conflict: null }
    : { draft: current, conflict: dictated };
}
