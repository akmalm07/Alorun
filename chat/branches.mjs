// Branch context deliberately contains only the direct parent's own messages at the fork.
export function makeBranch(parent, id, title = 'New branch') {
  return { id, title, titleLocked: false, parentId: parent.id, parentSnapshot: parent.messages.slice(-20).map(message => ({ ...message })), messages: [], revision: 0 };
}
export function contextFor(thread, nextMessage) {
  return [...(thread.parentSnapshot ?? []), ...thread.messages, nextMessage].slice(-20);
}
export function flattenThreads(threads) {
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const children = new Map();
  const roots = [];
  for (const thread of threads) {
    if (!thread.parentId || !byId.has(thread.parentId) || thread.parentId === thread.id) roots.push(thread);
    else children.set(thread.parentId, [...(children.get(thread.parentId) ?? []), thread]);
  }
  const rows = []; const seen = new Set();
  function visit(thread, rootId) {
    const stack = [{ thread, depth: 0 }];
    while (stack.length) {
      const row = stack.pop();
      if (seen.has(row.thread.id)) continue;
      seen.add(row.thread.id); rows.push({ ...row, rootId });
      const descendants = children.get(row.thread.id) ?? [];
      for (let i = descendants.length - 1; i >= 0; i--) stack.push({ thread: descendants[i], depth: row.depth + 1 });
    }
  }
  for (const root of roots) visit(root, root.id);
  // Corrupted cycles remain accessible instead of crashing navigation.
  for (const thread of threads) if (!seen.has(thread.id)) visit(thread, thread.id);
  return rows;
}
