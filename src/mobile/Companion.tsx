import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Alert,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { loadToday } from "./client";
import { useSession } from "./auth";
import { useCompanion } from "./useCompanion";
import { useVoiceCapture } from "./useVoiceCapture";
import { Button, colors, ErrorMessage, Field, styles } from "./ui";
import { PlanBuilder } from "./PlanBuilder";
import { combineDictation } from "../domain/conversation";
import type { ChatMode, Goal } from "../shared/contracts";

export default function Companion() {
  const session = useSession();
  const today = useQuery({
    queryKey: ["today", session?.user.id],
    queryFn: ({ signal }) => loadToday(signal),
  });
  const chat = useCompanion(session?.user.id ?? "");
  const capture = useVoiceCapture();
  const [mode, setMode] = useState<ChatMode>("think");
  const [draft, setDraft] = useState("");
  const [dictated, setDictated] = useState(false);
  const [dictationConflict, setDictationConflict] = useState<string | null>(
    null,
  );
  const [planning, setPlanning] = useState<Goal | null>(null);
  const disabled =
    chat.loading || chat.busy || chat.settingsBusy || capture.busy;
  const pendingReply =
    (chat.voiceActive ? chat.voiceTurns : chat.messages).at(-1)?.role ===
    "user";
  async function useClip() {
    if (!capture.clip) return;
    const text = await chat.transcribe(capture.clip, mode, chat.voiceActive);
    if (text) {
      if (!chat.voiceActive) {
        const combined = combineDictation(draft, text);
        setDraft(combined.draft);
        setDictationConflict(combined.conflict);
        setDictated(true);
      }
      await capture.discard();
    }
  }
  async function endVoice() {
    const ending = chat.endVoice();
    await capture.discard();
    await ending;
  }
  const backAction = useRef<() => void>(() => {});
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      backAction.current();
      return true;
    });
    return () => listener.remove();
  }, []);
  async function leave() {
    await endVoice();
    await chat.stopSpeaking();
    router.back();
  }
  backAction.current = () => {
    void leave();
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <View style={styles.row}>
        <Text style={[styles.title, { flexGrow: 1 }]}>Companion</Text>
        <Button title="Back to Today" secondary onPress={() => void leave()} />
      </View>
      <Text style={styles.body}>
        Talk through what’s getting in the way. Ask for an explanation, work
        through an example, or choose a next step for your goal.
      </Text>
      <View style={styles.row}>
        {(
          [
            ["listen", "Just listen"],
            ["think", "Help me think"],
            ["plan", "Make a plan"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            title={label}
            secondary={mode !== value}
            disabled={disabled || chat.voiceActive}
            onPress={() => setMode(value)}
          />
        ))}
      </View>
      {chat.loading && (
        <ActivityIndicator accessibilityLabel="Loading conversation" />
      )}
      {!chat.loading && !chat.messages.length && !chat.voiceActive && (
        <Text style={styles.muted}>
          What would you like help with? You can type, dictate a draft, or start
          a voice chat.
        </Text>
      )}
      {chat.messages.map((message) => (
        <View
          key={message.id}
          style={message.role === "assistant" ? styles.inset : styles.section}
        >
          <Text style={[styles.body, { fontWeight: "600" }]}>
            {message.role === "user" ? "You" : "Alorun"}
            {message.source === "voice"
              ? " · Voice chat transcript"
              : message.source === "dictation" && message.role === "user"
                ? " · Dictated"
                : ""}
          </Text>
          <Text selectable style={styles.body}>
            {message.content}
          </Text>
          {message.suggestedGoalId &&
            (() => {
              const goal = today.data?.goals.find(
                (g) => g.id === message.suggestedGoalId,
              );
              return goal ? (
                <Button
                  title={`Review a plan for ${goal.title}`}
                  disabled={disabled || chat.voiceActive}
                  onPress={() => setPlanning(goal)}
                />
              ) : null;
            })()}
        </View>
      ))}
      {planning && (
        <PlanBuilder
          key={planning.id}
          goal={planning}
          onClose={() => setPlanning(null)}
        />
      )}
      {chat.voiceActive && (
        <View style={styles.inset}>
          <Text style={styles.heading}>Voice conversation</Text>
          <Text style={styles.body}>
            Record a turn, then send it. Alorun will answer aloud. End voice
            chat to add both sides to the conversation above.
          </Text>
          <Text style={styles.muted}>
            {chat.voiceTurns.length} of 24 transcript entries in this session.
            Ending keeps completed entries and cancels any unfinished response.
          </Text>
          {chat.speaking && (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.body}>
                Alorun is speaking…
              </Text>
              <Button
                title="Stop speaking"
                secondary
                onPress={() => void chat.stopSpeaking()}
              />
            </>
          )}
          <Button
            title="End voice chat and show transcript"
            onPress={() => void endVoice()}
          />
        </View>
      )}
      {dictationConflict && (
        <View style={styles.inset}>
          <Text style={styles.heading}>Choose which draft to keep</Text>
          <Text style={styles.body}>
            Adding this dictation would exceed the 4,000-character message
            limit. Your current draft is unchanged.
          </Text>
          <Text selectable style={styles.body}>
            {dictationConflict}
          </Text>
          <Button
            title="Replace draft with dictation"
            onPress={() => {
              setDraft(dictationConflict);
              setDictated(true);
              setDictationConflict(null);
            }}
          />
          <Button
            title="Keep current draft"
            secondary
            onPress={() => setDictationConflict(null)}
          />
        </View>
      )}
      <ErrorMessage error={chat.error} />
      <ErrorMessage error={capture.error} />
      {chat.busy && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Processing your turn…
        </Text>
      )}
      {chat.busy && (
        <Button
          title="Cancel response"
          secondary
          onPress={() => chat.cancel()}
        />
      )}
      {!chat.busy && pendingReply && (
        <Button
          title="Retry AI reply"
          secondary
          disabled={disabled || capture.isRecording}
          onPress={() => void chat.retry(mode)}
        />
      )}
      {!chat.voiceActive && (
        <>
          <Field
            label="Message"
            value={draft}
            multiline
            maxLength={4000}
            editable={!disabled && !capture.isRecording}
            onChangeText={setDraft}
            placeholder="I keep putting off my exam revision…"
          />
          <Button
            title={chat.busy ? "Waiting for reply…" : "Send message"}
            disabled={disabled || capture.isRecording || !draft.trim()}
            onPress={() => {
              const text = draft;
              setDraft("");
              void chat.turn(text, mode, dictated ? "dictation" : "text");
              setDictated(false);
            }}
          />
        </>
      )}
      <View style={styles.section}>
        <Text style={styles.heading}>
          {chat.voiceActive ? "Your turn" : "Voice input"}
        </Text>
        <Text style={styles.muted}>
          Tap to record up to 60 seconds. Sending audio uses OpenAI
          transcription. Raw audio is not saved by Alorun. Spoken replies use
          your device’s speech engine.
        </Text>
        {capture.isRecording && (
          <Text accessibilityLiveRegion="polite" style={styles.body}>
            Recording · {capture.seconds} seconds
          </Text>
        )}
        {capture.clip && !capture.isRecording && (
          <Text style={styles.body}>
            Clip ready.{" "}
            {chat.voiceActive
              ? "Send your turn or discard it."
              : "Convert it to an editable draft."}
          </Text>
        )}
        {capture.isRecording ? (
          <Button
            title="Stop recording"
            disabled={capture.busy}
            onPress={() => void capture.stop()}
          />
        ) : (
          <Button
            title={
              chat.voiceActive ? "Record your next turn" : "Dictate a message"
            }
            disabled={
              disabled ||
              chat.speaking ||
              (chat.voiceActive && chat.voiceTurns.length >= 24)
            }
            onPress={() => void capture.start()}
          />
        )}
        {capture.clip && !capture.isRecording && (
          <View style={styles.row}>
            <Button
              title={
                chat.voiceActive ? "Send voice turn" : "Convert voice to text"
              }
              disabled={disabled}
              onPress={() => void useClip()}
            />
            <Button
              title="Discard clip"
              secondary
              disabled={disabled}
              onPress={() => void capture.discard()}
            />
          </View>
        )}
        {!chat.voiceActive && (
          <Button
            title="Start voice chat"
            secondary
            disabled={
              disabled ||
              capture.isRecording ||
              Boolean(capture.clip) ||
              Boolean(dictationConflict)
            }
            onPress={() => void chat.startVoice()}
          />
        )}
      </View>
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={[styles.body, { flex: 1 }]}>Save chat history</Text>
          <Switch
            accessibilityLabel="Save chat history"
            trackColor={{ true: colors.accent }}
            value={chat.historyEnabled}
            disabled={
              !chat.savingAvailable ||
              disabled ||
              chat.voiceActive ||
              capture.isRecording
            }
            onValueChange={(value) => void chat.toggleHistory(value)}
          />
        </View>
        <Text style={styles.muted}>
          {chat.historyEnabled
            ? "The visible conversation and future completed turns are saved encrypted. Voice turns are saved after you end voice chat."
            : "Chat stays temporary unless you turn on saving. Leaving the screen can discard temporary messages."}{" "}
          Saving chat does not enable AI memory. Turning saving off keeps
          previously saved data; Clear conversation removes it.
        </Text>
        {!chat.savingAvailable && (
          <Text style={styles.muted}>
            Saved chat is unavailable on this connection. You can still use
            temporary text and voice chat.
          </Text>
        )}
        <ErrorMessage error={chat.saveError} />
        {Boolean(chat.saveError) && chat.historyEnabled && (
          <Button
            title="Retry saving transcript"
            secondary
            disabled={disabled}
            onPress={chat.retrySave}
          />
        )}
        <Button
          title="Clear conversation"
          secondary
          disabled={disabled || chat.voiceActive || capture.isRecording}
          onPress={() =>
            Alert.alert(
              "Clear conversation?",
              "This removes the visible conversation and your saved chat history. Your goals and tasks stay available.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Clear",
                  style: "destructive",
                  onPress: () => void chat.clear(),
                },
              ],
            )
          }
        />
        <Button
          title="Reload saved history"
          secondary
          disabled={
            disabled ||
            chat.voiceActive ||
            capture.isRecording ||
            chat.messages.length > 0
          }
          onPress={() => void chat.reloadHistory()}
        />
      </View>
    </ScrollView>
  );
}
