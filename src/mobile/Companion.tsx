import { useEffect, useRef, useState, type ComponentRef } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, loadToday, supabase } from "./client";
import { useSession } from "./auth";
import { useCompanion } from "./useCompanion";
import { useVoiceCapture } from "./useVoiceCapture";
import { Button, colors, ErrorMessage, styles } from "./ui";
import { Sidebar, type SidebarDestination } from "./Sidebar";
import { PlanBuilder } from "./PlanBuilder";
import { combineDictation } from "../domain/conversation";
import { relevantSettings, settingsCatalog } from "../domain/settings-chat";
import type { ChatMode, Goal } from "../shared/contracts";

export default function Companion() {
  const params = useLocalSearchParams<{
    threadId?: string;
    selection?: string;
    settings?: string;
    fresh?: string;
  }>();
  const session = useSession();
  const today = useQuery({
    queryKey: ["today", session?.user.id],
    queryFn: ({ signal }) => loadToday(signal),
  });
  const chat = useCompanion(session?.user.id ?? "");
  const capture = useVoiceCapture();
  const wide = useWindowDimensions().width >= 800;
  const [drawer, setDrawer] = useState(false);
  const [settingsChat, setSettingsChat] = useState(false);
  const [settingsTurns, setSettingsTurns] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ChatMode>("think");
  const [voiceTools, setVoiceTools] = useState(false);
  const [planning, setPlanning] = useState<Goal | null>(null);
  const [dictated, setDictated] = useState(false);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const busy =
    chat.loading ||
    chat.busy ||
    chat.settingsBusy ||
    capture.busy ||
    capture.isRecording ||
    chat.voiceActive;
  const checkins = useMutation({
    mutationFn: (enabled: boolean) =>
      api("/settings/goal-checkins", "PATCH", { enabled }),
    onSuccess: () => today.refetch(),
  });
  const navigation = useRef({ drawer, settingsChat });
  navigation.current = { drawer, settingsChat };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (navigation.current.drawer) setDrawer(false);
      else if (navigation.current.settingsChat) setSettingsChat(false);
      else {
        void chat.endVoice();
        void capture.discard();
        router.back();
      }
      return true;
    });
    return () => listener.remove();
  }, []);
  function openSettings() {
    if (busy) return;
    setSettingsChat(true);
    setDrawer(false);
    setDraft("");
  }
  function switchTo(id: string) {
    if (busy) return;
    setSettingsChat(false);
    setDrawer(false);
    setDraft("");
    void chat.selectThread(id);
  }
  function start(branch = false) {
    if (busy) return;
    setSettingsChat(false);
    setDrawer(false);
    if (!branch) setDraft("");
    void chat.newThread(branch);
  }
  const routeKey = `${params.threadId ?? ""}:${params.selection ?? ""}:${params.settings ?? ""}:${params.fresh ?? ""}`;
  const handledRoute = useRef("");
  useEffect(() => {
    if (chat.loading || handledRoute.current === routeKey) return;
    handledRoute.current = routeKey;
    if (params.settings) {
      setSettingsChat(true);
      setDraft("");
    } else if (params.fresh) {
      setSettingsChat(false);
      setDraft("");
      void chat.newThread();
    } else if (params.threadId) {
      setSettingsChat(false);
      setDraft("");
      void chat.selectThread(params.threadId);
    } else setSettingsChat(false);
  }, [routeKey, chat.loading]);
  function navigate(destination: SidebarDestination) {
    setDrawer(false);
    if (destination === "settings") openSettings();
    else if (destination === "chat") setSettingsChat(false);
    else if (destination === "today") router.navigate("/");
    else router.navigate("/missions");
  }
  function sidebar() {
    return (
      <Sidebar
        threads={chat.threads}
        activeId={chat.activeId}
        active={settingsChat ? "settings" : "chat"}
        busy={busy}
        onClose={wide ? undefined : () => setDrawer(false)}
        onNew={() => start()}
        onNavigate={navigate}
        onSelect={switchTo}
        onPin={(id, value) => void chat.pinThread(id, value)}
        onSignOut={() => void supabase?.auth.signOut()}
        historyLabel={
          chat.historyEnabled
            ? "History saving is on"
            : "Temporary chats · not saved after leaving"
        }
      />
    );
  }
  function settingControl(id: string) {
    if (id === "history")
      return (
        <View style={{ gap: 12 }}>
          <View style={styles.row}>
            <Text style={[styles.body, { flex: 1 }]}>Save chat history</Text>
            <Switch
              accessibilityLabel="Save chat history"
              value={chat.historyEnabled}
              disabled={busy || !chat.savingAvailable}
              onValueChange={(v) => void chat.toggleHistory(v)}
            />
          </View>
          {!chat.savingAvailable && (
            <Text style={styles.muted}>
              Saving is not configured on this connection. Temporary chat is
              available.
            </Text>
          )}
          <Button
            title="Clear all chat history"
            secondary
            disabled={busy}
            onPress={() =>
              Alert.alert(
                "Clear all conversations?",
                "Removes saved conversations, pins and branch context. Goals and tasks stay.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear all",
                    style: "destructive",
                    onPress: () => void chat.clear(),
                  },
                ],
              )
            }
          />
        </View>
      );
    if (id === "checkins")
      return (
        <View style={styles.row}>
          <Text style={[styles.body, { flex: 1 }]}>Voice goal check-ins</Text>
          <Switch
            accessibilityLabel="Voice goal check-ins"
            value={today.data?.checkinsEnabled ?? false}
            disabled={!today.data || checkins.isPending}
            onValueChange={(v) => checkins.mutate(v)}
          />
        </View>
      );
    if (id === "missions")
      return (
        <Button
          title="Open Missions"
          secondary
          onPress={() => router.push("/missions")}
        />
      );
    if (id === "account")
      return (
        <Button
          title="Sign out"
          secondary
          onPress={() => void supabase?.auth.signOut()}
        />
      );
    return null;
  }
  function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (settingsChat) setSettingsTurns((old) => [...old, text]);
    else {
      void chat.turn(text, mode, dictated ? "dictation" : "text");
      setDictated(false);
    }
  }
  async function useClip() {
    if (!capture.clip) return;
    const text = await chat.transcribe(capture.clip, mode, chat.voiceActive);
    if (text && !chat.voiceActive) {
      const combined = combineDictation(draft, text);
      if (combined.conflict)
        Alert.alert(
          "Draft is too long",
          "Your current draft is unchanged. Shorten it before adding dictation.",
        );
      else {
        setDraft(combined.draft);
        setDictated(true);
      }
    }
    if (text) await capture.discard();
  }
  return (
    <View style={s.shell}>
      {wide && <View style={{ width: 280 }}>{sidebar()}</View>}
      {!wide && (
        <Modal
          visible={drawer}
          transparent
          animationType="slide"
          onRequestClose={() => setDrawer(false)}
        >
          <View style={s.drawerBackdrop}>
            <View style={s.drawer}>{sidebar()}</View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close sidebar"
              style={{ flex: 1 }}
              onPress={() => setDrawer(false)}
            />
          </View>
        </Modal>
      )}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={s.header}>
          {!wide && (
            <Button title="Menu" secondary onPress={() => setDrawer(true)} />
          )}
          <Text
            accessibilityRole="header"
            style={[styles.heading, { flex: 1 }]}
          >
            {settingsChat ? "Settings chat" : "Alorun"}
          </Text>
          <Button
            title={settingsChat ? "Chat" : "New"}
            secondary
            disabled={busy}
            onPress={() => (settingsChat ? setSettingsChat(false) : start())}
          />
        </View>
        {!settingsChat && (
          <View style={s.modes}>
            {(
              [
                ["listen", "Listen"],
                ["think", "Think"],
                ["plan", "Plan"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{
                  selected: mode === value,
                  disabled: busy,
                }}
                disabled={busy}
                style={[s.mode, mode === value && s.selected]}
                onPress={() => setMode(value)}
              >
                <Text
                  style={[
                    styles.muted,
                    mode === value && {
                      color: colors.accent,
                      fontWeight: "600",
                    },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <ScrollView
          ref={list}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.transcript}
          onContentSizeChange={() =>
            list.current?.scrollToEnd({ animated: true })
          }
        >
          {settingsChat ? (
            <>
              <Text style={styles.heading}>Your settings, in conversation</Text>
              <Text style={styles.muted}>
                This dedicated chat knows the app’s available settings and shows
                the most relevant controls for your question. It uses a local
                settings guide, not an AI model. Nothing changes until you tap a
                control.
              </Text>
              {!settingsTurns.length && (
                <>
                  {[
                    "How is my chat history saved?",
                    "Change my voice check-ins",
                    "How do pinned chats work?",
                  ].map((q) => (
                    <Button
                      key={q}
                      title={q}
                      secondary
                      onPress={() => setSettingsTurns((old) => [...old, q])}
                    />
                  ))}
                </>
              )}
              {settingsTurns.map((prompt, index) => {
                const found = relevantSettings(prompt);
                return (
                  <View key={index} style={{ gap: 18 }}>
                    <View style={s.userMessage}>
                      <Text selectable style={styles.body}>
                        {prompt}
                      </Text>
                    </View>
                    <Text style={styles.body}>
                      {found.length
                        ? "Here are the settings that match your question."
                        : "I couldn’t match that request. These are the available settings; choose a topic or ask more specifically."}
                    </Text>
                    {(found.length ? found : settingsCatalog).map((setting) => (
                      <View key={setting.id} style={styles.section}>
                        <Text style={styles.label}>{setting.label}</Text>
                        <Text style={styles.muted}>{setting.description}</Text>
                        {settingControl(setting.id)}
                      </View>
                    ))}
                  </View>
                );
              })}
            </>
          ) : (
            <>
              {chat.loading && (
                <ActivityIndicator accessibilityLabel="Loading chats" />
              )}
              {!chat.loading && !chat.messages.length && !chat.voiceActive && (
                <View style={s.empty}>
                  <Text style={styles.title}>What’s on your mind?</Text>
                  <Text style={styles.muted}>
                    {chat.metadata.parentId
                      ? "This branch starts with a fixed snapshot of its parent’s recent messages. New replies stay in this branch."
                      : "Think it through, make a plan, or simply be heard."}
                  </Text>
                  <Text style={s.caption}>
                    {chat.historyEnabled
                      ? "History saving is on."
                      : "Temporary chat. Turn on saving in Settings chat to keep your conversations."}
                  </Text>
                </View>
              )}
              {chat.messages.map((message) => (
                <View
                  key={message.id}
                  style={
                    message.role === "user" ? s.userMessage : s.assistantMessage
                  }
                >
                  {message.role === "assistant" && (
                    <Text style={s.caption}>Alorun</Text>
                  )}
                  <Text selectable style={styles.body}>
                    {message.content}
                  </Text>
                  {message.suggestedGoalId &&
                    today.data?.goals.find(
                      (g) => g.id === message.suggestedGoalId,
                    ) && (
                      <Button
                        title="Review goal plan"
                        secondary
                        disabled={busy}
                        onPress={() =>
                          setPlanning(
                            today.data!.goals.find(
                              (g) => g.id === message.suggestedGoalId,
                            )!,
                          )
                        }
                      />
                    )}
                </View>
              ))}
              {planning && (
                <PlanBuilder
                  goal={planning}
                  onClose={() => setPlanning(null)}
                />
              )}
              {chat.voiceTurns.map((message) => (
                <View
                  key={message.id}
                  style={
                    message.role === "user" ? s.userMessage : s.assistantMessage
                  }
                >
                  <Text style={s.caption}>
                    {message.role === "user" ? "You · voice" : "Alorun · voice"}
                  </Text>
                  <Text selectable style={styles.body}>
                    {message.content}
                  </Text>
                </View>
              ))}
              {chat.busy && (
                <Text accessibilityLiveRegion="polite" style={styles.muted}>
                  Thinking…
                </Text>
              )}
              <ErrorMessage error={chat.error} />
              {!chat.busy &&
                (chat.voiceActive ? chat.voiceTurns : chat.messages).at(-1)
                  ?.role === "user" && (
                  <Button
                    title="Retry reply"
                    secondary
                    disabled={chat.loading || capture.busy}
                    onPress={() => void chat.retry(mode)}
                  />
                )}
              {voiceTools && (
                <View style={styles.section}>
                  <Text style={styles.heading}>Voice</Text>
                  <Text style={styles.muted}>
                    Record up to 60 seconds. Audio is sent for transcription and
                    is not saved by Alorun. Dictation is editable before
                    sending. Voice chat replies use device speech.
                  </Text>
                  {capture.isRecording ? (
                    <>
                      <Text style={styles.body}>
                        Recording · {capture.seconds}s
                      </Text>
                      <Button
                        title="Stop recording"
                        onPress={() => void capture.stop()}
                      />
                    </>
                  ) : (
                    <Button
                      title={
                        chat.voiceActive
                          ? "Record next turn"
                          : "Dictate message"
                      }
                      disabled={chat.busy || capture.busy || chat.speaking}
                      onPress={() => void capture.start()}
                    />
                  )}
                  {capture.clip && !capture.isRecording && (
                    <>
                      <Button
                        title={
                          chat.voiceActive
                            ? "Send voice turn"
                            : "Convert to draft"
                        }
                        disabled={chat.busy}
                        onPress={() => void useClip()}
                      />
                      <Button
                        title="Discard clip"
                        secondary
                        onPress={() => void capture.discard()}
                      />
                    </>
                  )}
                  {!chat.voiceActive ? (
                    <Button
                      title="Start voice conversation"
                      secondary
                      disabled={busy || Boolean(capture.clip)}
                      onPress={() => void chat.startVoice()}
                    />
                  ) : (
                    <Button
                      title="End voice & keep transcript"
                      secondary
                      onPress={() => {
                        void chat.endVoice();
                        void capture.discard();
                      }}
                    />
                  )}
                  {chat.speaking && (
                    <Button
                      title="Stop speaking"
                      secondary
                      onPress={() => void chat.stopSpeaking()}
                    />
                  )}
                </View>
              )}
            </>
          )}
          <ErrorMessage error={capture.error} />
          <ErrorMessage error={chat.saveError} />
          <ErrorMessage error={checkins.error} />
          {Boolean(chat.saveError) && (
            <Button
              title="Retry saving"
              secondary
              disabled={busy}
              onPress={chat.retrySave}
            />
          )}
        </ScrollView>
        <View style={s.composer}>
          <TextInput
            accessibilityLabel={
              settingsChat ? "Ask about settings" : "Message Alorun"
            }
            placeholder={
              settingsChat ? "Ask about a setting…" : "Message Alorun…"
            }
            placeholderTextColor={colors.muted}
            multiline
            maxLength={4000}
            value={draft}
            onChangeText={setDraft}
            editable={settingsChat || !busy}
            style={s.input}
          />
          <View style={styles.row}>
            {!settingsChat && (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !chat.messages.length}
                  onPress={() => start(true)}
                  style={s.smallAction}
                >
                  <Text
                    style={[
                      styles.muted,
                      (busy || !chat.messages.length) && { opacity: 0.4 },
                    ]}
                  >
                    Branch
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setVoiceTools((v) => !v)}
                  style={s.smallAction}
                >
                  <Text style={styles.muted}>
                    {voiceTools ? "Hide voice" : "Voice"}
                  </Text>
                </Pressable>
              </>
            )}
            <View style={{ flex: 1 }} />
            {chat.busy && !settingsChat ? (
              <Button title="Stop" secondary onPress={chat.cancel} />
            ) : (
              <Button
                title="Send"
                disabled={!draft.trim() || (!settingsChat && busy)}
                onPress={send}
              />
            )}
          </View>
        </View>
        <Text style={s.footer}>
          {settingsChat
            ? "Settings guide · you control every change"
            : "Alorun can make mistakes. Review important details."}
        </Text>
      </KeyboardAvoidingView>
    </View>
  );
}
const s = StyleSheet.create({
  shell: { flex: 1, flexDirection: "row", backgroundColor: colors.background },
  drawerBackdrop: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#00000099",
  },
  drawer: { width: "85%", maxWidth: 320 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  modes: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  mode: {
    minHeight: 40,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 20,
  },
  selected: { backgroundColor: colors.accentSoft },
  caption: { fontSize: 12, lineHeight: 18, color: colors.muted },
  smallAction: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  transcript: {
    padding: 20,
    gap: 24,
    flexGrow: 1,
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingBottom: 32,
  },
  empty: { flex: 1, justifyContent: "center", gap: 18, paddingVertical: 48 },
  userMessage: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    backgroundColor: colors.secondary,
    padding: 16,
    borderRadius: 20,
    gap: 8,
  },
  assistantMessage: { alignSelf: "stretch", gap: 10, paddingVertical: 6 },
  composer: {
    marginHorizontal: 14,
    padding: 12,
    gap: 8,
    borderRadius: 24,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 780,
    width: "94%",
    alignSelf: "center",
  },
  input: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    minHeight: 44,
    maxHeight: 150,
    padding: 8,
  },
  footer: {
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
    padding: 10,
  },
});
