import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import type { Checkin } from "../shared/contracts";
import { api, newId } from "./client";
import { Button, ErrorMessage, styles } from "./ui";

export function VoiceCheckin({
  checkin,
  onClose,
}: {
  checkin: Checkin;
  onClose: () => void;
}) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
    bitRate: 64000,
  });
  const state = useAudioRecorderState(recorder, 200);
  const [clip, setClip] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const started = useRef(false);
  const fileUri = useRef<string | null>(null);
  const removeClip = (uri: string | null) => {
    if (uri) {
      const file = new File(uri);
      if (file.exists) file.delete();
    }
    fileUri.current = null;
  };
  useEffect(() => {
    active.current = true;
    const discard = async () => {
      started.current = false;
      let uri = fileUri.current;
      try {
        if (recorder.isRecording) await recorder.stop();
        uri = recorder.uri ?? uri;
      } catch {
        /* The recorder may already be released. Still remove the cached file below. */
      }
      try {
        removeClip(uri);
      } catch {
        /* The OS may have removed the interrupted capture. */
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (active.current) setClip(null);
    };
    const listener = AppState.addEventListener("change", (next) => {
      if (next !== "active") void discard();
    });
    return () => {
      active.current = false;
      listener.remove();
      void discard();
    };
  }, [recorder]);
  useEffect(() => {
    if (
      started.current &&
      !state.isRecording &&
      state.durationMillis > 0 &&
      recorder.uri
    ) {
      fileUri.current = recorder.uri;
      setClip(recorder.uri);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  }, [state.isRecording, state.durationMillis, recorder]);
  async function record() {
    setError(undefined);
    setBusy(true);
    let didStart = false;
    try {
      removeClip(clip);
      setClip(null);
      const permission = await requestRecordingPermissionsAsync();
      if (!active.current || AppState.currentState !== "active") return;
      if (!permission.granted)
        throw new Error(
          "Microphone access is off. Enable it in device settings or choose “Not now”. Your tasks remain available.",
        );
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      fileUri.current = recorder.uri;
      if (!active.current || AppState.currentState !== "active") {
        await recorder.stop();
        removeClip(recorder.uri);
        return;
      }
      started.current = true;
      recorder.record({ forDuration: 60 });
      didStart = true;
    } catch (e) {
      if (active.current) setError(e);
    } finally {
      if (!didStart || !active.current)
        await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (active.current) setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      await recorder.stop();
      fileUri.current = recorder.uri;
      setClip(recorder.uri);
      await setAudioModeAsync({ allowsRecording: false });
    } catch (e) {
      setError(e);
    } finally {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      setBusy(false);
    }
  }
  async function send() {
    if (!clip) return;
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.append("requestId", newId());
      // React Native FormData accepts a native file descriptor; its DOM type only declares Blob.
      form.append("audio", {
        uri: clip,
        name: "response.m4a",
        type: "audio/mp4",
      } as unknown as Blob);
      await api(`/checkins/${checkin.id}/voice`, "POST", form);
      removeClip(clip);
      onClose();
    } catch (e) {
      if (active.current) setError(e);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function skip() {
    setBusy(true);
    setError(undefined);
    try {
      if (recorder.isRecording) await recorder.stop();
      started.current = false;
      removeClip(clip ?? recorder.uri);
      setClip(null);
      await api(`/checkins/${checkin.id}/skip`, "POST");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (active.current) setBusy(false);
    }
  }
  return (
    <View style={styles.inset}>
      <Text style={styles.heading}>A moment for your goal</Text>
      <Text style={styles.body}>{checkin.question}</Text>
      <Text style={styles.muted}>
        Reply by voice, up to 60 seconds. Sending shares audio with OpenAI for
        transcription. Alorun does not save your recording or transcript as
        memory. Your answer won’t mark tasks complete.
      </Text>
      {state.isRecording && (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          Recording · {Math.floor(state.durationMillis / 1000)} seconds
        </Text>
      )}
      {clip && !state.isRecording && (
        <Text style={styles.body}>
          Recording ready. Send it or record again.
        </Text>
      )}
      <ErrorMessage error={error} />
      <View style={styles.row}>
        {state.isRecording ? (
          <Button
            title="Stop recording"
            disabled={busy}
            onPress={() => void stop()}
          />
        ) : (
          <Button
            title={clip ? "Record again" : "Record answer"}
            disabled={busy}
            onPress={() => void record()}
          />
        )}
        {clip && !state.isRecording && (
          <Button
            title={busy ? "Sending…" : "Send voice answer"}
            disabled={busy}
            onPress={() => void send()}
          />
        )}
        <Button
          title="Not now"
          secondary
          disabled={busy}
          onPress={() => void skip()}
        />
      </View>
    </View>
  );
}
