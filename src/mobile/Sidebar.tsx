import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ThreadSummary } from "../shared/contracts";
import { appDestinations, type AppDestination } from "../shared/navigation";
import { isPinned } from "../domain/settings-chat";
import { Button, colors, styles } from "./ui";
export type SidebarDestination = AppDestination;
export function Sidebar({
  threads,
  activeId,
  active,
  busy = false,
  onClose,
  onNew,
  onNavigate,
  onSelect,
  onPin,
  onSignOut,
  historyLabel,
}: {
  threads: ThreadSummary[];
  activeId?: string;
  active: SidebarDestination;
  busy?: boolean;
  onClose?: () => void;
  onNew: () => void;
  onNavigate: (destination: SidebarDestination) => void;
  onSelect: (id: string) => void;
  onPin: (id: string, value: "pinned" | "unpinned") => void;
  onSignOut?: () => void;
  historyLabel?: string;
}) {
  return (
    <View style={navStyles.sidebar}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={navStyles.brand}>Alorun</Text>
          <Text style={navStyles.caption}>A clearer next step</Text>
        </View>
        {onClose && <Button title="Close" secondary onPress={onClose} />}
      </View>
      <Button title="New chat" disabled={busy} onPress={onNew} />
      <View style={{ gap: 4 }}>
        {appDestinations.map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityState={{ selected: active === id, disabled: busy }}
            disabled={busy}
            onPress={() => onNavigate(id)}
            style={[navStyles.destination, active === id && navStyles.selected]}
          >
            <Text
              style={[
                styles.body,
                active === id && { color: colors.accent, fontWeight: "600" },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 20 }}>
        {[
          { label: "Pinned chats", items: threads.filter(isPinned) },
          { label: "Recent chats", items: threads.filter((t) => !isPinned(t)) },
        ].map((group) => (
          <View key={group.label} style={{ gap: 6 }}>
            <Text style={navStyles.group}>{group.label}</Text>
            {!group.items.length && (
              <Text style={navStyles.caption}>Nothing here yet.</Text>
            )}
            {group.items.map((thread) => (
              <View
                key={thread.id}
                style={[
                  navStyles.thread,
                  active === "chat" &&
                    activeId === thread.id &&
                    navStyles.selected,
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => onSelect(thread.id)}
                  style={{ flex: 1, paddingVertical: 12 }}
                >
                  <Text numberOfLines={2} style={styles.body}>
                    {thread.parentId ? "Branch · " : ""}
                    {thread.parentId
                      ? thread.title.replace(/^Branch:\s*/, "")
                      : thread.title}
                  </Text>
                  {isPinned(thread) && (
                    <Text style={navStyles.caption}>
                      {thread.manualPin === "pinned"
                        ? "Pinned by you"
                        : "Auto-pinned · goal-linked"}
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isPinned(thread) ? "Unpin" : "Pin"} ${thread.title}`}
                  disabled={busy}
                  onPress={() =>
                    onPin(thread.id, isPinned(thread) ? "unpinned" : "pinned")
                  }
                  style={navStyles.pin}
                >
                  <Text style={navStyles.caption}>
                    {isPinned(thread) ? "Unpin" : "Pin"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      <Text style={navStyles.caption}>
        Goal-linked chats may auto-pin. Your pin or unpin always takes priority.
      </Text>
      {historyLabel && <Text style={navStyles.caption}>{historyLabel}</Text>}
      {onSignOut && (
        <Button
          title="Sign out"
          secondary
          disabled={busy}
          onPress={onSignOut}
        />
      )}
    </View>
  );
}
export const navStyles = StyleSheet.create({
  sidebar: {
    flex: 1,
    backgroundColor: colors.sidebar,
    padding: 20,
    gap: 18,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  brand: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.ink,
    letterSpacing: -0.6,
  },
  caption: { fontSize: 12, lineHeight: 18, color: colors.muted },
  group: { fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 8 },
  destination: {
    minHeight: 48,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: 12,
  },
  selected: { backgroundColor: colors.accentSoft },
  thread: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pin: {
    minHeight: 48,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
