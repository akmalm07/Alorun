export const appDestinations = [
  ["today", "Today & goals"],
  ["chat", "Conversations"],
  ["missions", "Missions"],
  ["settings", "Settings chat"],
] as const;

export type AppDestination = (typeof appDestinations)[number][0];
