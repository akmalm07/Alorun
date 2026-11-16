import { router } from "expo-router";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { api, configured, supabase } from "./client";
import { Button, ErrorMessage, Field, styles } from "./ui";

const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext);
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const currentUser = useRef<string | undefined>(undefined);
  currentUser.current = session?.user.id;
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setSession(data.session);
        setError(error);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e);
          setLoading(false);
        }
      });
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        // Clear tenant data immediately when the authenticated account changes.
        setSession((old) => {
          if (old?.user.id !== next?.user.id) {
            setReady(false);
            queryClient.clear();
          }
          return next;
        });
      },
    );
    const state = AppState.addEventListener("change", (value) => {
      if (value === "active") supabase?.auth.startAutoRefresh();
      else supabase?.auth.stopAutoRefresh();
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      state.remove();
    };
  }, [queryClient]);
  const bootstrap = async () => {
    const userId = session?.user.id;
    setError(undefined);
    try {
      await api("/me", "POST", {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      if (currentUser.current === userId) setReady(true);
    } catch (e) {
      if (currentUser.current === userId) setError(e);
    }
  };
  useEffect(() => {
    if (session?.user.id) void bootstrap();
  }, [session?.user.id]);
  if (loading)
    return (
      <View style={styles.content}>
        <ActivityIndicator accessibilityLabel="Loading session" />
      </View>
    );
  if (!configured)
    return (
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to Alorun</Text>
        <Text style={styles.body}>
          Connect the app to your API and Supabase project to start planning.
        </Text>
        <Text style={styles.muted}>
          Setup instructions are in the project README.
        </Text>
        <Button
          title="Open encrypted chat and branches"
          secondary
          onPress={() => router.push("/encrypted-chat")}
        />
      </View>
    );
  if (session && ready)
    return (
      <SessionContext.Provider value={session}>
        {children}
      </SessionContext.Provider>
    );
  async function authenticate() {
    if (!supabase) return;
    setBusy(true);
    setError(undefined);
    try {
      if (sentTo) {
        const { error } = await supabase.auth.verifyOtp({
          email: sentTo,
          token: code.trim(),
          type: "email",
        });
        if (error) throw error;
      } else {
        const normalized = email.trim().toLowerCase();
        const { error } = await supabase.auth.signInWithOtp({
          email: normalized,
        });
        if (error) throw error;
        setSentTo(normalized);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>Welcome to Alorun</Text>
      <Text style={styles.body}>
        Make room for what matters. Turn a goal into a plan you can follow.
      </Text>
      {session ? (
        <>
          <ErrorMessage error={error} />
          {!error && (
            <ActivityIndicator accessibilityLabel="Connecting account" />
          )}
          <Button title="Retry connection" onPress={() => void bootstrap()} />
          <Button
            title="Sign out"
            secondary
            onPress={() => void supabase?.auth.signOut()}
          />
        </>
      ) : (
        <>
          {sentTo ? (
            <>
              <Text style={styles.body}>
                Enter the email code sent to {sentTo}.
              </Text>
              <Field
                label="Email code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
              />
            </>
          ) : (
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          )}
          <ErrorMessage error={error} />
          <Button
            title={
              busy
                ? "Please wait…"
                : sentTo
                  ? "Verify code"
                  : "Send sign-in code"
            }
            disabled={busy || (sentTo ? !code.trim() : !email.includes("@"))}
            onPress={() => void authenticate()}
          />
          {sentTo && (
            <Button
              title="Use another email"
              secondary
              onPress={() => {
                setSentTo(null);
                setCode("");
              }}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}
