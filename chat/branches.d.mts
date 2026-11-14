export type BranchMessage = { role: 'user' | 'assistant'; content: string };
export type BranchThread = { id: string; title: string; titleLocked: boolean; parentId?: string | null; parentSnapshot?: BranchMessage[]; messages: BranchMessage[]; revision: number };
export function makeBranch(parent: BranchThread, id: string, title?: string): BranchThread;
export function contextFor(thread: BranchThread, nextMessage: BranchMessage): BranchMessage[];
export function flattenThreads<T extends BranchThread>(threads: T[]): { thread: T; depth: number; rootId: string }[];
