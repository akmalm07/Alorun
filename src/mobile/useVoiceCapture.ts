import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";

export function useVoiceCapture() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    numberOfChannels: 1,
    bitRate: 64000,
  });
  const state = useAudioRecorderState(recorder, 200);
  const [clip, setClip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const mounted = useRef(true);
  const epoch = useRef(0);
  const uri = useRef<string | null>(null);
  const capturing = useRef(false);
  const erase = (path: string | null) => {
    if (path) {
      const file = new File(path);
      if (file.exists) file.delete();
    }
  };
  async function discard() {
    epoch.current++;
    capturing.current = false;
    let path = uri.current;
    try {
      if (recorder.isRecording) await recorder.stop();
      path = recorder.uri ?? path;
    } catch {
      /* Native recorder may already be released. */
    }
    try {
      erase(path);
    } catch {
      /* OS may have removed the cache file. */
    }
    uri.current = null;
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (mounted.current) {
      setClip(null);
      setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", (next) => {
      if (next !== "active") void discard();
    });
    return () => {
      mounted.current = false;
      listener.remove();
      void discard();
    };
  }, [recorder]);
  useEffect(() => {
    if (capturing.current && !state.isRecording && state.durationMillis > 0) {
      try {
        if (recorder.uri) {
          uri.current = recorder.uri;
          setClip(recorder.uri);
        }
      } catch {
        /* Released recorder is no longer readable. */
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  }, [recorder, state.isRecording, state.durationMillis]);
  async function start() {
    await discard();
    const generation = epoch.current;
    setBusy(true);
    setError(undefined);
    let didStart = false;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (
        !mounted.current ||
        epoch.current !== generation ||
        AppState.currentState !== "active"
      )
        return;
      if (!permission.granted)
        throw new Error(
          "Microphone access is off. You can enable it in device settings or keep typing.",
        );
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      uri.current = recorder.uri;
      if (
        !mounted.current ||
        epoch.current !== generation ||
        AppState.currentState !== "active"
      ) {
        await discard();
        return;
      }
      capturing.current = true;
      recorder.record({ forDuration: 60 });
      didStart = true;
    } catch (e) {
      if (mounted.current && generation === epoch.current) setError(e);
    } finally {
      if (!didStart || !mounted.current || generation !== epoch.current)
        await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (mounted.current && generation === epoch.current) setBusy(false);
    }
  }
  async function stop() {
    const generation = epoch.current;
    setBusy(true);
    setError(undefined);
    try {
      await recorder.stop();
      if (mounted.current && generation === epoch.current) {
        uri.current = recorder.uri;
        setClip(recorder.uri);
      }
    } catch (e) {
      if (mounted.current && generation === epoch.current) setError(e);
    } finally {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (mounted.current && generation === epoch.current) setBusy(false);
    }
  }
  return {
    clip,
    busy,
    error,
    isRecording: state.isRecording,
    seconds: Math.floor(state.durationMillis / 1000),
    start,
    stop,
    discard,
  };
}
