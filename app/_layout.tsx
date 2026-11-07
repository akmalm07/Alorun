import { Redirect, Stack, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';

function Navigation() {
  const { status } = useAuth();
  const segments = useSegments();
  const onAuth = segments[0] === 'auth';
  if (status === 'loading') return <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f8f2'}}><ActivityIndicator color="#315d4b" /></View>;
  if (status === 'signedOut' && !onAuth) return <Redirect href="/auth" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
export default function RootLayout() { return <AuthProvider><Navigation /></AuthProvider>; }
