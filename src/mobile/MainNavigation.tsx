import { useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { z } from "zod";
import { threadSummarySchema } from "../shared/contracts";
import { api, newId, supabase } from "./client";
import { useSession } from "./auth";
import { Sidebar, type SidebarDestination } from "./Sidebar";
import { Button, colors, ErrorMessage, styles } from "./ui";
export function MainNavigation({
  children,
  title,
  active,
}: {
  children: ReactNode;
  title: string;
  active: "today" | "missions";
}) {
  const owner = useSession()?.user.id;
  const query = useQueryClient();
  const [open, setOpen] = useState(false);
  const wide = useWindowDimensions().width >= 800;
  const threads = useQuery({
    queryKey: ["sidebarThreads", owner],
    queryFn: async () =>
      z
        .object({ threads: z.array(threadSummarySchema) })
        .parse(await api("/chat/threads", "GET", undefined, undefined, owner)),
    enabled: Boolean(owner),
  });
  useFocusEffect(
    useCallback(() => {
      void query.invalidateQueries({ queryKey: ["sidebarThreads", owner] });
    }, [query, owner]),
  );
  const pin = useMutation({
    mutationFn: ({ id, value }: { id: string; value: "pinned" | "unpinned" }) =>
      api(
        `/chat/threads/${id}/pin`,
        "PATCH",
        { manualPin: value },
        undefined,
        owner,
      ),
    onSuccess: () =>
      query.invalidateQueries({ queryKey: ["sidebarThreads", owner] }),
  });
  function navigate(destination: SidebarDestination) {
    setOpen(false);
    if (destination === active) return;
    if (destination === "today") router.navigate("/");
    else if (destination === "missions") router.navigate("/missions");
    else
      router.navigate({
        pathname: "/companion",
        params: {
          threadId: "",
          fresh: "",
          settings: destination === "settings" ? newId() : "",
          selection: newId(),
        },
      });
  }
  function panel() {
    return (
      <View style={{ flex: 1 }}>
        <Sidebar
          threads={threads.data?.threads ?? []}
          active={active}
          busy={pin.isPending}
          onClose={wide ? undefined : () => setOpen(false)}
          onNew={() => {
            setOpen(false);
            router.navigate({
              pathname: "/companion",
              params: {
                fresh: newId(),
                settings: "",
                threadId: "",
                selection: newId(),
              },
            });
          }}
          onNavigate={navigate}
          onSelect={(id) => {
            setOpen(false);
            router.navigate({
              pathname: "/companion",
              params: {
                threadId: id,
                selection: newId(),
                settings: "",
                fresh: "",
              },
            });
          }}
          onPin={(id, value) => pin.mutate({ id, value })}
          onSignOut={() => void supabase?.auth.signOut()}
        />
        {(threads.error || pin.error) && (
          <View style={{ padding: 16, backgroundColor: colors.sidebar }}>
            <ErrorMessage error={threads.error || pin.error} />
            <Button
              title="Retry chats"
              secondary
              onPress={() => void threads.refetch()}
            />
          </View>
        )}
      </View>
    );
  }
  return (
    <View style={s.shell}>
      {wide && <View style={{ width: 292 }}>{panel()}</View>}
      {!wide && (
        <Modal
          visible={open}
          transparent
          animationType="slide"
          onRequestClose={() => setOpen(false)}
        >
          <View style={s.overlay}>
            <View style={s.drawer}>{panel()}</View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close navigation"
              style={{ flex: 1 }}
              onPress={() => setOpen(false)}
            />
          </View>
        </Modal>
      )}
      <View style={{ flex: 1 }}>
        <View style={s.header}>
          {!wide && (
            <Button
              title="Menu"
              secondary
              onPress={() => {
                setOpen(true);
                void threads.refetch();
              }}
            />
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.brand}>Alorun</Text>
            <Text accessibilityRole="header" style={styles.heading}>
              {title}
            </Text>
          </View>
        </View>
        {children}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brand: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 3,
  },
  overlay: { flex: 1, flexDirection: "row", backgroundColor: "#00000080" },
  drawer: { width: "88%", maxWidth: 340 },
});
