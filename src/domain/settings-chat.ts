export const settingsCatalog = [
  {
    id: "history",
    label: "Chat history",
    description:
      "Choose whether conversations are saved encrypted. Saving history does not enable AI memory.",
    terms: [
      "history",
      "save",
      "privacy",
      "remember",
      "memory",
      "delete",
      "forget",
      "conversation",
    ],
  },
  {
    id: "checkins",
    label: "Voice goal check-ins",
    description:
      "Optional goal questions on app open, at most once every 24 hours. You can always dismiss them.",
    terms: ["check", "remind", "notification", "voice", "prompt", "goal"],
  },
  {
    id: "appearance",
    label: "Appearance",
    description:
      "Alorun uses a charcoal gray theme with green accents throughout the app.",
    terms: ["theme", "black", "dark", "color", "appearance", "display"],
  },
  {
    id: "pins",
    label: "Pinned chats and branches",
    description:
      "Goal-linked planning chats can be pinned automatically. Your manual pin or unpin always wins. Branch in the composer to explore a separate direction.",
    terms: ["pin", "important", "branch", "sidebar", "recent"],
  },
  {
    id: "missions",
    label: "Missions",
    description:
      "Manage recurring goal documents, their schedule and paused state on the Missions screen.",
    terms: ["mission", "schedule", "document", "recurring"],
  },
  {
    id: "account",
    label: "Account",
    description:
      "Sign out of your account. Account export and deletion are not yet available in this app.",
    terms: [
      "account",
      "sign",
      "logout",
      "email",
      "password",
      "export",
      "delete",
    ],
  },
] as const;
export function relevantSettings(prompt: string) {
  const words = prompt.toLowerCase().split(/\W+/).filter(Boolean);
  return settingsCatalog
    .map((setting) => ({
      setting,
      score: setting.terms.filter((term) =>
        words.some((word) => word.startsWith(term)),
      ).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.setting);
}
export function isPinned(thread: {
  manualPin: "pinned" | "unpinned" | null;
  autoPin: boolean;
}) {
  return (
    thread.manualPin === "pinned" ||
    (thread.manualPin === null && thread.autoPin)
  );
}
