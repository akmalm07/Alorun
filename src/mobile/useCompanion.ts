import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Speech from "expo-speech";
import { z } from "zod";
import { makeBranch } from "../../chat/branches.mjs";
import {
  chatHistorySchema,
  chatSettingsSchema,
  chatClearSchema,
  chatReplySchema,
  transcriptionSchema,
  type ChatMessage,
  type ChatMode,
  threadMetaSchema,
  threadSummarySchema,
  type ThreadMeta,
  type ThreadSummary,
} from "../shared/contracts";
import { mergeConversation, recentConversation } from "../domain/conversation";
import { api, newId } from "./client";

export function useCompanion(ownerId: string) {
  function chatApi(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) {
    return api(path, method, body, signal, ownerId);
  }
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [voiceTurns, setVoiceTurns] = useState<ChatMessage[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [savingAvailable, setSavingAvailable] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saveError, setSaveError] = useState<unknown>();
  const [settingsBusy, setSettingsBusy] = useState(false);
  const thread = useRef(newId());
  const meta = useRef<ThreadMeta>(
    threadMetaSchema.parse({ title: "New chat" }),
  );
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState(thread.current);
  const local = useRef(
    new Map<
      string,
      { messages: ChatMessage[]; metadata: ThreadMeta; saved: Set<string> }
    >(),
  );
  function remember() {
    local.current.set(thread.current, {
      messages: [...all.current],
      metadata: { ...meta.current },
      saved: new Set(savedIds.current),
    });
    const summary = {
      ...meta.current,
      lastActiveAt: new Date().toISOString(),
      id: thread.current,
      createdAt: new Date().toISOString(),
    };
    setThreads((old) => [summary, ...old.filter((t) => t.id !== summary.id)]);
  }
  async function refreshThreads() {
    const result = z
      .object({ threads: z.array(threadSummarySchema) })
      .parse(await chatApi("/chat/threads"));
    if (mounted.current)
      setThreads((old) => [
        ...old.filter((t) => !result.threads.some((r) => r.id === t.id)),
        ...result.threads,
      ]);
  }
  const historyVersion = useRef<string | null>(null);
  const all = useRef<ChatMessage[]>([]);
  const voice = useRef<ChatMessage[]>([]);
  const live = useRef(false);
  const enabled = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const savedIds = useRef(new Set<string>());

  function updateMessages(next: ChatMessage[]) {
    all.current = next;
    setMessages(next);
    if (next.length) {
      if (meta.current.title === "New chat")
        meta.current.title =
          next.find((m) => m.role === "user")?.content.slice(0, 60) ||
          "New chat";
      meta.current.autoPin ||= next.some(
        (m) => m.role === "assistant" && m.suggestedGoalId !== null,
      );
      remember();
    }
  }
  function updateVoice(next: ChatMessage[]) {
    voice.current = next;
    setVoiceTurns(next);
  }
  async function reloadHistory(id?: string) {
    setLoading(true);
    setError(undefined);
    try {
      const data = chatHistorySchema.parse(
        await chatApi(`/chat/history${id ? `?threadId=${id}` : ""}`),
      );
      if (!mounted.current) return;
      if (data.threadId) thread.current = data.threadId;
      meta.current =
        data.metadata ?? threadMetaSchema.parse({ title: "New chat" });
      setActiveId(thread.current);
      historyVersion.current = data.historyVersion;
      enabled.current = data.saveHistory;
      setHistoryEnabled(data.saveHistory);
      setSavingAvailable(data.savingAvailable);
      savedIds.current = new Set(data.messages.map((message) => message.id));
      updateMessages(data.messages);
      await refreshThreads();
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void reloadHistory();
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        void Speech.stop();
        setSpeaking(false);
      }
    });
    return () => {
      mounted.current = false;
      generation.current++;
      request.current?.abort();
      listener.remove();
      void Speech.stop();
    };
  }, []);

  function save(next: ChatMessage[]) {
    if (!enabled.current || !next.length) return;
    const capturedThread = thread.current;
    const capturedVersion = historyVersion.current;
    const captured = [...next];
    const capturedMeta = { ...meta.current };
    const capturedSavedIds = savedIds.current;
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(async () => {
        if (!enabled.current) return;
        const unsaved = captured.filter(
          (message) => !capturedSavedIds.has(message.id),
        );
        try {
          for (let offset = 0; offset < unsaved.length; offset += 60) {
            if (!enabled.current) return;
            const chunk = unsaved.slice(offset, offset + 60);
            const result = await chatApi("/chat/history", "POST", {
              threadId: capturedThread,
              historyVersion: capturedVersion,
              messages: chunk,
              metadata: capturedMeta,
            });
            if (!(
              result &&
              typeof result === "object" &&
              "saved" in result &&
              result.saved === true
            )) {
              enabled.current = false;
              if (mounted.current) setHistoryEnabled(false);
              throw new Error(
                "History saving is off. Your messages remain temporary.",
              );
            }
            for (const message of chunk) capturedSavedIds.add(message.id);
          }
          if (mounted.current) {
            setSaveError(undefined);
            await refreshThreads();
          }
        } catch (e) {
          if (mounted.current) setSaveError(e);
        }
      });
  }
  function appendUser(
    content: string,
    source: ChatMessage["source"],
    toVoice: boolean,
  ) {
    const message: ChatMessage = {
      id: newId(),
      role: "user",
      content,
      source,
      suggestedGoalId: null,
    };
    if (toVoice) updateVoice([...voice.current, message]);
    else {
      const next = [...all.current, message];
      updateMessages(next);
      save(next);
    }
  }
  async function ask(
    mode: ChatMode,
    source: ChatMessage["source"],
    toVoice: boolean,
    token: number,
    signal: AbortSignal,
  ) {
    const requestThread = thread.current;
    const history = recentConversation([
      ...meta.current.parentSnapshot,
      ...all.current,
      ...(toVoice ? voice.current : []),
    ]);
    const result = chatReplySchema.parse(
      await chatApi(
        "/chat/reply",
        "POST",
        { requestId: newId(), mode, messages: history },
        signal,
      ),
    );
    if (
      !mounted.current ||
      generation.current !== token ||
      thread.current !== requestThread ||
      (toVoice && !live.current)
    )
      return;
    const assistant: ChatMessage = {
      id: newId(),
      role: "assistant",
      content: result.reply,
      source,
      suggestedGoalId: result.suggestedGoalId,
    };
    if (toVoice) {
      updateVoice([...voice.current, assistant]);
      if (AppState.currentState === "active") {
        await Speech.stop();
        if (
          !mounted.current ||
          generation.current !== token ||
          !live.current ||
          AppState.currentState !== "active"
        )
          return;
        setSpeaking(true);
        Speech.speak(result.reply, {
          onDone: () => {
            if (mounted.current && generation.current === token)
              setSpeaking(false);
          },
          onStopped: () => {
            if (mounted.current) setSpeaking(false);
          },
          onError: () => {
            if (mounted.current) {
              setSpeaking(false);
              setError(
                new Error(
                  "The reply is ready, but speech playback failed. End voice chat to read the transcript.",
                ),
              );
            }
          },
        });
      }
    } else {
      const next = [...all.current, assistant];
      updateMessages(next);
      save(next);
    }
  }
  async function turn(
    content: string,
    mode: ChatMode,
    source: "text" | "dictation",
  ) {
    if (inFlight.current || live.current || !content.trim()) return;
    if (content.trim().length > 4000) {
      setError(
        new Error("Shorten the message to 4,000 characters before sending."),
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const token = generation.current;
    request.current = new AbortController();
    appendUser(content.trim(), source, false);
    try {
      await ask(mode, source, false, token, request.current.signal);
    } catch (e) {
      if (mounted.current && token === generation.current) setError(e);
    } finally {
      if (token === generation.current) {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function retry(mode: ChatMode) {
    if (inFlight.current) return;
    const toVoice = live.current;
    const turns = toVoice ? voice.current : all.current;
    if (turns.at(-1)?.role !== "user") return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const token = generation.current;
    request.current = new AbortController();
    try {
      await ask(
        mode,
        toVoice ? "voice" : turns.at(-1)!.source,
        toVoice,
        token,
        request.current.signal,
      );
    } catch (e) {
      if (mounted.current && token === generation.current) setError(e);
    } finally {
      if (token === generation.current) {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function transcribe(
    uri: string,
    mode: ChatMode,
    toVoice: boolean,
  ): Promise<string | null> {
    if (inFlight.current) return null;
    if (toVoice && voice.current.length >= 24) {
      setError(
        new Error(
          "This session has reached 12 voice turns. End it to keep the transcript, then start another.",
        ),
      );
      return null;
    }
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    const token = generation.current;
    request.current = new AbortController();
    let recognized: string | null = null;
    try {
      const data = new FormData();
      data.append("requestId", newId());
      data.append("audio", {
        uri,
        name: "voice.m4a",
        type: "audio/mp4",
      } as unknown as Blob);
      const result = transcriptionSchema.parse(
        await chatApi("/chat/transcribe", "POST", data, request.current.signal),
      );
      if (
        !mounted.current ||
        token !== generation.current ||
        (toVoice && !live.current)
      )
        return null;
      recognized = result.text;
      if (toVoice) {
        appendUser(result.text, "voice", true);
        await ask(mode, "voice", true, token, request.current.signal);
      }
      return result.text;
    } catch (e) {
      if (mounted.current && token === generation.current) setError(e);
      return token === generation.current ? recognized : null;
    } finally {
      if (token === generation.current) {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function startVoice() {
    if (inFlight.current) return;
    generation.current++;
    live.current = true;
    setVoiceActive(true);
    updateVoice([]);
    setError(undefined);
    await Speech.stop();
    setSpeaking(false);
  }
  async function endVoice() {
    if (!live.current) return;
    generation.current++;
    request.current?.abort();
    inFlight.current = false;
    live.current = false;
    setVoiceActive(false);
    setBusy(false);
    setSpeaking(false);
    const next = mergeConversation(all.current, voice.current);
    updateMessages(next);
    updateVoice([]);
    save(next);
    await Speech.stop();
  }
  async function toggleHistory(value: boolean) {
    setSettingsBusy(true);
    setSaveError(undefined);
    try {
      if (
        value &&
        meta.current.parentId &&
        local.current.has(meta.current.parentId) &&
        !local.current.get(meta.current.parentId)!.saved.size
      )
        throw new Error(
          "Save the parent conversation first, then create a new branch to keep it in history.",
        );
      // Disable locally before draining writes; server checks consent under its own lock too.
      if (!value) enabled.current = false;
      await saveQueue.current;
      const updated = chatSettingsSchema.parse(
        await chatApi("/chat/settings", "PATCH", { saveHistory: value }),
      );
      historyVersion.current = updated.historyVersion;
      if (!mounted.current) return;
      enabled.current = value;
      setHistoryEnabled(value);
      if (value) save(all.current);
    } catch (e) {
      enabled.current = historyEnabled;
      if (mounted.current) setSaveError(e);
    } finally {
      if (mounted.current) setSettingsBusy(false);
    }
  }
  async function clear() {
    setSettingsBusy(true);
    setSaveError(undefined);
    try {
      await saveQueue.current;
      const cleared = chatClearSchema.parse(
        await chatApi("/chat/history", "DELETE"),
      );
      historyVersion.current = cleared.historyVersion;
      if (!mounted.current) return;
      generation.current++;
      thread.current = newId();
      meta.current = threadMetaSchema.parse({ title: "New chat" });
      local.current.clear();
      setThreads([]);
      setActiveId(thread.current);
      savedIds.current.clear();
      updateMessages([]);
    } catch (e) {
      if (mounted.current) setSaveError(e);
    } finally {
      if (mounted.current) setSettingsBusy(false);
    }
  }
  async function selectThread(id: string) {
    if (inFlight.current || live.current || loading || id === thread.current)
      return;
    inFlight.current = true;
    setLoading(true);
    generation.current++;
    try {
      await saveQueue.current;
      if (!mounted.current) return;
      remember();
      const cached = local.current.get(id);
      if (cached) {
        thread.current = id;
        meta.current = { ...cached.metadata };
        savedIds.current = new Set(cached.saved);
        setActiveId(id);
        updateMessages(cached.messages);
        setError(undefined);
      } else await reloadHistory(id);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  async function newThread(branch = false) {
    if (inFlight.current || live.current || loading) return;
    inFlight.current = true;
    setLoading(true);
    generation.current++;
    try {
      await saveQueue.current;
      if (!mounted.current) return;
      const parent = {
        id: thread.current,
        title: meta.current.title,
        titleLocked: false,
        messages: all.current,
        revision: 0,
      };
      remember();
      const id = newId();
      const fork = branch
        ? makeBranch(parent, id, `Branch: ${meta.current.title}`.slice(0, 60))
        : null;
      thread.current = id;
      meta.current = threadMetaSchema.parse({
        title: fork?.title || "New chat",
        parentId: fork?.parentId || null,
        parentSnapshot:
          fork?.parentSnapshot?.map((m) => ({
            role: m.role,
            content: m.content,
          })) || [],
      });
      savedIds.current = new Set();
      setActiveId(id);
      updateMessages([]);
      remember();
      setError(undefined);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  async function pinThread(id: string, manualPin: ThreadMeta["manualPin"]) {
    const summary = threads.find((t) => t.id === id);
    if (!summary || inFlight.current || live.current || loading) return;
    inFlight.current = true;
    setSettingsBusy(true);
    try {
      await saveQueue.current;
      const cached = local.current.get(id);
      if (enabled.current && (!cached || cached.saved.size))
        await chatApi(`/chat/threads/${id}/pin`, "PATCH", { manualPin });
      if (id === thread.current) meta.current.manualPin = manualPin;
      if (cached) cached.metadata.manualPin = manualPin;
      setThreads((old) =>
        old.map((t) => (t.id === id ? { ...t, manualPin } : t)),
      );
    } catch (e) {
      setError(e);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSettingsBusy(false);
    }
  }
  return {
    threads,
    activeId,
    metadata: meta.current,
    selectThread,
    newThread,
    pinThread,
    messages,
    voiceTurns,
    voiceActive,
    busy,
    speaking,
    loading,
    error,
    saveError,
    historyEnabled,
    savingAvailable,
    settingsBusy,
    turn,
    retry,
    transcribe,
    startVoice,
    endVoice,
    toggleHistory,
    clear,
    reloadHistory,
    retrySave: () => save(all.current),
    cancel: () => {
      generation.current++;
      request.current?.abort();
      inFlight.current = false;
      setBusy(false);
    },
    stopSpeaking: async () => {
      await Speech.stop();
      if (mounted.current) setSpeaking(false);
    },
  };
}
