import { useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import { Logo } from '../src/ui/shell';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit() {
    if (!email.trim() || !password) { setMessage('Enter your email and password to continue.'); return; }
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        router.replace('/');
      } else {
        const signedIn = await signUp(email.trim(), password);
        if (signedIn) router.replace('/');
        else { setMessage('Check your email to confirm your account, then sign in.'); setMode('signin'); setPassword(''); }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  }
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}><Logo /><Text style={styles.brandName}>alorun</Text></View>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>A LITTLE MORE ROOM TO THINK</Text>
          <Text style={styles.heading}>{mode === 'signin' ? 'Welcome back.' : 'Start where you are.'}</Text>
          <Text style={styles.description}>A calmer place for your plans, your priorities, and everything in between.</Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.formTitle}>{mode === 'signin' ? 'Sign in' : 'Create your account'}</Text>
          <Text style={styles.label}>Email address</Text>
          <TextInput accessibilityLabel="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#9b9d98" style={styles.input} />
          <Text style={styles.label}>Password</Text>
          <TextInput accessibilityLabel="Password" autoCapitalize="none" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} secureTextEntry value={password} onChangeText={setPassword} placeholder="Enter your password" placeholderTextColor="#9b9d98" style={styles.input} />
          {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={[styles.primary, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{mode === 'signin' ? 'Sign in' : 'Create account'}  →</Text>}</Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }} style={styles.switch}><Text style={styles.switchText}>{mode === 'signin' ? 'New here?  Create an account' : 'Already have an account?  Sign in'}</Text></Pressable>
        </View>
        <Text style={styles.footer}>A little progress, on your terms.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7f7f1' }, content: { flexGrow: 1, paddingHorizontal: 26, paddingTop: 70, paddingBottom: 32, maxWidth: 520, width: '100%', alignSelf: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 }, brandMark: { backgroundColor: '#264d3f', color: '#fff', overflow: 'hidden', width: 38, height: 38, borderRadius: 12, textAlign: 'center', textAlignVertical: 'center', fontSize: 22, fontWeight: '700' }, brandName: { fontSize: 20, fontWeight: '700', color: '#263e34', letterSpacing: -0.5 },
  intro: { marginTop: 76, marginBottom: 36 }, eyebrow: { color: '#76917c', fontSize: 10, fontWeight: '700', letterSpacing: 1.8, marginBottom: 14 }, heading: { color: '#243b31', fontSize: 38, fontWeight: '700', letterSpacing: -1.5 }, description: { color: '#68766c', fontSize: 16, lineHeight: 25, marginTop: 12, maxWidth: 320 },
  form: { backgroundColor: '#fff', borderRadius: 22, padding: 24, borderWidth: 1, borderColor: '#ebeee7' }, formTitle: { color: '#263e34', fontSize: 20, fontWeight: '700', marginBottom: 22 }, label: { color: '#46574b', fontSize: 13, fontWeight: '700', marginBottom: 8 }, input: { height: 52, borderWidth: 1, borderColor: '#dce4da', borderRadius: 10, paddingHorizontal: 14, fontSize: 15, color: '#263e34', marginBottom: 19 }, message: { color: '#a45b44', lineHeight: 20, marginBottom: 14 }, primary: { minHeight: 52, borderRadius: 10, backgroundColor: '#315b48', alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.6 }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' }, switch: { paddingTop: 21, alignItems: 'center' }, switchText: { color: '#587360', fontSize: 13, fontWeight: '600' }, footer: { color: '#9ba99b', fontSize: 12, textAlign: 'center', marginTop: 28 },
});
