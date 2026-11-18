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
  Animated,
  AppState,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Session } from "@supabase/supabase-js";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { api, configured, supabase } from "./client";
import { Brand, Button, ErrorMessage, Field, styles } from "./ui";

const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext);

function Welcome({ onContinue }: { onContinue: () => void }) {
  const offset = useRef(new Animated.Value(0)).current;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dx < -10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) =>
        offset.setValue(Math.min(0, gesture.dx)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -70) {
          Animated.timing(offset, {
            toValue: -400,
            duration: 180,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) onContinue();
          });
        } else {
          Animated.spring(offset, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;
  return (
    <View style={welcomeStyles.screen} {...responder.panHandlers}>
      <Animated.View
        style={[
          welcomeStyles.logoFrame,
          { transform: [{ translateX: offset }] },
        ]}
      >
        <Image
          // Metro requires a static require to bundle a local image asset.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require("../../assets/alorun_full_logo.png")}
          style={welcomeStyles.logo}
          resizeMode="contain"
          accessibilityLabel="Alorun"
        />
      </Animated.View>
      <Pressable
        accessibilityRole="button"
        onPress={onContinue}
        style={welcomeStyles.continue}
      >
        <Text style={welcomeStyles.continueText}>
          Swipe left or tap to sign in
        </Text>
      </Pressable>
    </View>
  );
}

const welcomeStyles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  logoFrame: {
    width: "100%",
    maxWidth: 320,
    aspectRatio: 1,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#f9f3ed",
  },
  logo: { width: "100%", height: "100%" },
  continue: {
    position: "absolute",
    bottom: 48,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  continueText: {
    color: "#e5e5e5",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"password" | "code">("password");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const queryClient = useQueryClient();
  const currentUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
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
  if (session && ready)
    return (
      <SessionContext.Provider value={session}>
        {children}
      </SessionContext.Provider>
    );
  if (!session && !showSignIn)
    return <Welcome onContinue={() => setShowSignIn(true)} />;
  async function authenticate(resend = false) {
    if (!supabase) return;
    setBusy(true);
    setError(undefined);
    try {
      if (method === "password") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
        setPassword("");
      } else if (sentTo && !resend) {
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
        setNow(Date.now());
        setResendAt(Date.now() + 60000);
      }
    } catch (e) {
      const failure = e as { code?: string; status?: number };
      setError(
        new Error(
          failure.code === "invalid_credentials"
            ? "Email or password is incorrect. Try again or sign in with an email code."
            : failure.code === "otp_expired"
              ? "That code is invalid or expired. Check it or request a new code."
              : failure.status === 429
                ? "Too many attempts. Please wait a minute before trying again."
                : "We couldn’t sign you in. Check your connection and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <Brand />
      <Text style={styles.title}>
        {sentTo
          ? "Check your email"
          : session
            ? "Connecting your account"
            : "Welcome back"}
      </Text>
      <Text style={styles.body}>
        {sentTo
          ? "Enter your code to continue."
          : "A little clarity. A next step that feels possible."}
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
          {!configured && (
            <Text accessibilityRole="alert" style={styles.error}>
              Sign-in is temporarily unavailable. Please check the app setup and
              try again.
            </Text>
          )}
          {!sentTo && (
            <Text style={styles.muted}>
              {method === "password"
                ? "Sign in with your email and password."
                : "New here? An email code creates your account. Returning users can use the same email."}
            </Text>
          )}
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
                maxLength={8}
                editable={!busy}
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
              autoCorrect={false}
              editable={!busy}
            />
          )}
          {method === "password" && (
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              autoCapitalize="none"
              editable={!busy}
              onSubmitEditing={() => {
                if (password && z.email().safeParse(email.trim()).success)
                  void authenticate();
              }}
            />
          )}
          <ErrorMessage error={error} />
          <Button
            title={
              busy
                ? "Please wait…"
                : method === "password"
                  ? "Sign in"
                  : sentTo
                    ? "Verify code"
                    : "Send sign-in code"
            }
            disabled={
              !configured ||
              busy ||
              (method === "password"
                ? !password || !z.email().safeParse(email.trim()).success
                : sentTo
                  ? !/^\d{6,8}$/.test(code.trim())
                  : !z.email().safeParse(email.trim()).success)
            }
            onPress={() => void authenticate()}
          />
          {sentTo && (
            <Button
              title={
                now < resendAt
                  ? `Resend code in ${Math.ceil((resendAt - now) / 1000)}s`
                  : "Resend code"
              }
              secondary
              disabled={busy || now < resendAt}
              onPress={() => void authenticate(true)}
            />
          )}
          {sentTo && (
            <Button
              title="Use another email"
              secondary
              onPress={() => {
                setSentTo(null);
                setCode("");
                setError(undefined);
              }}
            />
          )}
          {!sentTo && (
            <>
              <Button
                title={
                  method === "password"
                    ? "Use an email code / create account"
                    : "Use a password instead"
                }
                secondary
                disabled={busy}
                onPress={() => {
                  setMethod(method === "password" ? "code" : "password");
                  setError(undefined);
                  setPassword("");
                }}
              />
              <Button
                title="Continue with Google — coming soon"
                secondary
                disabled
                onPress={() => {}}
              />
              <Text style={styles.muted}>
                Google sign-in is not available yet.
              </Text>
            </>
          )}
          {!configured && (
            <Button
              title="Open encrypted chat and branches"
              secondary
              onPress={() => router.push("/encrypted-chat")}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}
