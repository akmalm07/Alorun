import "../security/polyfills";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { styles } from "../src/mobile/ui";
export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
      }),
  );
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <QueryClientProvider client={client}>
          <Stack screenOptions={{ headerShown: false }} />
        </QueryClientProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
