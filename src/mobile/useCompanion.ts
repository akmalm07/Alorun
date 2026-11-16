import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Speech from "expo-speech";
import {
  chatHistorySchema,
  chatSettingsSchema,
  chatClearSchema,
  chatReplySchema,
  transcriptionSchema,
  type ChatMessage,
  type ChatMode,
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
  }
  function updateVoice(next: ChatMessage[]) {
    voice.current = next;
    setVoiceTurns(next);
  }
  async function reloadHistory() {
    setLoading(true);
    setError(undefined);
    try {
      const data = chatHistorySchema.parse(await chatApi("/chat/history"));
      if (!mounted.current) return;
      if (data.threadId) thread.current = data.threadId;
      historyVersion.current = data.historyVersion;
      enabled.current = data.saveHistory;
      setHistoryEnabled(data.saveHistory);
      setSavingAvailable(data.savingAvailable);
      savedIds.current = new Set(data.messages.map((message) => message.id));
      updateMessages(data.messages);
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
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(async () => {
        if (!enabled.current) return;
        const unsaved = captured.filter(
          (message) => !savedIds.current.has(message.id),
        );
        try {
          for (let offset = 0; offset < unsaved.length; offset += 60) {
            if (!enabled.current) return;
            const chunk = unsaved.slice(offset, offset + 60);
            const result = await chatApi("/chat/history", "POST", {
              threadId: capturedThread,
              historyVersion: capturedVersion,
              messages: chunk,
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
            for (const message of chunk) savedIds.current.add(message.id);
          }
          if (mounted.current) setSaveError(undefined);
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
    const history = recentConversation([
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
      savedIds.current.clear();
      updateMessages([]);
    } catch (e) {
      if (mounted.current) setSaveError(e);
    } finally {
      if (mounted.current) setSettingsBusy(false);
    }
  }
  return {
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
