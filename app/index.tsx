import '../security/polyfills';
import { createClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { createVault, unlockVault, encryptRecord, decryptRecord, type Envelope } from '../security/vault.mjs';

const apiUrl = process.env.EXPO_PUBLIC_CHAT_API_URL;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const auth = supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('https://') ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
const threadSchema = z.object({ title: z.string().max(60), titleLocked: z.boolean(), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }).strict()) }).strict();
type Thread = z.infer<typeof threadSchema> & { id: string; revision: number };
type Message = Thread['messages'][number];
const modelsSchema = z.object({ models: z.array(z.object({ provider: z.enum(['openai', 'anthropic']), model: z.string().min(1).max(100) })).min(1) });
type ModelChoice = z.infer<typeof modelsSchema>['models'][number];
const listSchema = z.object({ threads: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive(), envelope: z.unknown() })) });

async function request(token: string, path: string, method = 'GET', body?: object): Promise<unknown> {
  if (!apiUrl?.startsWith('https://')) throw new Error('A secure HTTPS chat server is required.');
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 409) throw new Error('This conversation changed on another device. Reload it before trying again.');
  if (!response.ok) throw new Error('The server could not complete the request.');
  return response.json();
}
export default function HomeScreen() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [account, setAccount] = useState<{id: string; token: string} | null>(null);
  const [wrapped, setWrapped] = useState<unknown>(undefined);
  const [passphrase, setPassphrase] = useState(''); const [confirm, setConfirm] = useState('');
  const key = useRef<Uint8Array | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [models, setModels] = useState<ModelChoice[]>([]); const [selection, setSelection] = useState<ModelChoice | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]); const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState(''); const [editing, setEditing] = useState(false); const [titleDraft, setTitleDraft] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const busy = useRef(false);
  const list = useRef<FlatList<Message>>(null);
  const thread = threads.find(item => item.id === current);
  async function run(action: () => Promise<void>) {
    if (busy.current) return; busy.current = true; setPending(true); setError('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); } finally { busy.current = false; setPending(false); }
  }
  async function login() { await run(async () => {
    if (!auth) throw new Error('Configure the HTTPS account service in the app.');
    const { data, error: authError } = await auth.auth.signInWithPassword({ email: email.trim(), password });
    if (authError || !data.session) throw new Error('Could not sign in. Check your account details.');
    try {
      const [vaultResult, modelsResult] = await Promise.all([request(data.session.access_token, '/v1/vault'), request(data.session.access_token, '/v1/ai/models')]);
      const vault = z.object({ vault: z.unknown().nullable() }).parse(vaultResult).vault;
      const available = modelsSchema.parse(modelsResult).models; setModels(available); setSelection(available[0]);
      setWrapped(vault); setAccount({ id: data.session.user.id, token: data.session.access_token }); setPassword('');
    } catch (e) { await auth.auth.signOut(); throw e; }
  }); }
  async function load(accountId: string, token: string, dataKey: Uint8Array) {
    const result = listSchema.parse(await request(token, '/v1/encrypted-threads'));
    return result.threads.map(item => ({ ...threadSchema.parse(JSON.parse(decryptRecord(dataKey, accountId, 'thread', item.id, item.envelope))), id: item.id, revision: item.revision }));
  }
  async function unlock() { await run(async () => {
    if (!account) return;
    if (passphrase.length < 12) throw new Error('Use an encryption passphrase of at least 12 characters.');
    let dataKey: Uint8Array;
    if (wrapped === null) {
      if (passphrase !== confirm) throw new Error('The passphrases do not match.');
      const result = await createVault(account.id, passphrase, Crypto.getRandomBytes);
      try { await request(account.token, '/v1/vault', 'POST', result.wrappedKey); }
      catch (e) { result.key.fill(0); throw e; }
      dataKey = result.key; setWrapped(result.wrappedKey);
    } else {
      try { dataKey = await unlockVault(account.id, passphrase, wrapped); } catch { throw new Error('Could not unlock. Check your encryption passphrase.'); }
    }
    try { const data = await load(account.id, account.token, dataKey); key.current = dataKey; setThreads(data); setUnlocked(true); setPassphrase(''); setConfirm(''); }
    catch (e) { dataKey.fill(0); throw e; }
  }); }
  function lock() { key.current?.fill(0); key.current = null; setUnlocked(false); setThreads([]); setCurrent(null); setDraft(''); setTitleDraft(''); setPassphrase(''); setConfirm(''); }
  async function logout() { lock(); setAccount(null); setWrapped(undefined); setModels([]); setSelection(null); setPassword(''); await auth?.auth.signOut(); }
  async function save(next: Thread) {
    if (!account || !key.current) throw new Error('Unlock your data first.');
    const { id, revision, ...content } = next;
    const encrypted: Envelope = encryptRecord(key.current, account.id, 'thread', id, JSON.stringify(content), Crypto.getRandomBytes);
    const result = z.object({ revision: z.number().int().positive() }).parse(await request(account.token, `/v1/encrypted-threads/${id}`, 'PUT', { envelope: encrypted, revision }));
    const updated = { ...next, revision: result.revision };
    setThreads(items => [updated, ...items.filter(item => item.id !== id)]); setCurrent(id);
  }
  async function create() { await run(async () => { await save({ id: Crypto.randomUUID(), title: 'New conversation', titleLocked: false, messages: [], revision: 0 }); setDraft(''); }); }
  async function refresh() { await run(async () => { if (!account || !key.current) return; setThreads(await load(account.id, account.token, key.current)); }); }
  async function rename() { if (!thread || !titleDraft.trim()) return; await run(async () => { await save({ ...thread, title: titleDraft.trim(), titleLocked: true }); setEditing(false); }); }
  async function send() { const content = draft.trim(); if (!content || !thread || !account || !selection) return; await run(async () => {
    const messages: Message[] = [...thread.messages, { role: 'user', content }];
    const answer = z.object({ reply: z.string().min(1).max(12000), title: z.string().max(60).nullable() }).parse(await request(account.token, '/v1/ai/reply', 'POST', { messages: messages.slice(-20), title: thread.title, titleLocked: thread.titleLocked, provider: selection.provider, model: selection.model }));
    await save({ ...thread, title: thread.titleLocked ? thread.title : answer.title || thread.title, messages: [...messages, { role: 'assistant', content: answer.reply }] }); setDraft('');
  }); }
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}><Text style={styles.eyebrow}>ALORUN</Text><Text style={styles.title}>{!account ? 'Sign in' : !unlocked ? 'Unlock your data' : 'Your conversations'}</Text></View>
    {!account ? <View style={styles.panel}><TextInput accessibilityLabel="Email" placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} /><TextInput accessibilityLabel="Account password" placeholder="Account password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} /><Pressable disabled={pending} style={styles.button} onPress={login}><Text style={styles.buttonText}>Sign in</Text></Pressable><Text style={styles.note}>Use an existing account. Data is encrypted using a separate passphrase.</Text></View> : !unlocked ? <View style={styles.panel}><Text style={styles.note}>{wrapped === null ? 'Create a separate encryption passphrase. If you lose it, your saved data cannot be recovered.' : 'Enter your encryption passphrase to unlock this device.'}</Text><TextInput accessibilityLabel="Encryption passphrase" placeholder="Encryption passphrase" secureTextEntry value={passphrase} onChangeText={setPassphrase} style={styles.input} />{wrapped === null && <TextInput accessibilityLabel="Confirm encryption passphrase" placeholder="Confirm passphrase" secureTextEntry value={confirm} onChangeText={setConfirm} style={styles.input} />}<Pressable disabled={pending} style={styles.button} onPress={unlock}><Text style={styles.buttonText}>{wrapped === null ? 'Create encrypted vault' : 'Unlock'}</Text></Pressable><Pressable onPress={logout}><Text style={styles.link}>Sign out</Text></Pressable></View> : <>
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.navigation}><Pressable disabled={pending} style={styles.chip} onPress={create}><Text style={styles.link}>+ New</Text></Pressable><Pressable disabled={pending} style={styles.chip} onPress={refresh}><Text style={styles.link}>Reload</Text></Pressable><Pressable disabled={pending} style={styles.chip} onPress={lock}><Text style={styles.link}>Lock</Text></Pressable><Pressable disabled={pending} style={styles.chip} onPress={logout}><Text style={styles.link}>Sign out</Text></Pressable>{threads.map(item => <Pressable key={item.id} disabled={pending} style={styles.chip} onPress={() => { setCurrent(item.id); setDraft(''); setEditing(false); }}><Text style={styles.link}>{item.title}</Text></Pressable>)}</ScrollView>
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.navigation} accessibilityLabel="AI provider and model">{models.map(item => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selection?.provider === item.provider && selection?.model === item.model }} key={`${item.provider}:${item.model}`} disabled={pending} style={[styles.chip, selection?.provider === item.provider && selection?.model === item.model && { backgroundColor: '#c1d8c4' }]} onPress={() => setSelection(item)}><Text style={styles.link}>{item.provider === 'openai' ? 'OpenAI' : 'Anthropic'} · {item.model}</Text></Pressable>)}</ScrollView>
      {thread && <View style={styles.navigation}>{editing ? <><TextInput accessibilityLabel="Conversation title" style={styles.input} value={titleDraft} onChangeText={setTitleDraft} maxLength={60} /><Pressable disabled={pending} onPress={rename} style={styles.chip}><Text style={styles.link}>Save</Text></Pressable></> : <><Text style={styles.heading}>{thread.title}</Text><Pressable disabled={pending} onPress={() => { setTitleDraft(thread.title); setEditing(true); }} style={styles.chip}><Text style={styles.link}>Edit title</Text></Pressable></>}</View>}
      <FlatList ref={list} style={styles.list} contentContainerStyle={styles.messages} data={thread?.messages ?? []} keyExtractor={(_, i) => String(i)} onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })} ListEmptyComponent={<Text style={styles.note}>Choose or start a conversation. Messages sent to AI are processed by the server and selected provider.</Text>} renderItem={({ item }) => <View style={styles.bubble}><Text style={styles.link}>{item.role === 'user' ? 'YOU' : 'ALORUN'}</Text><Text selectable style={styles.message}>{item.content}</Text></View>} />
      {thread && <View style={styles.composer}><TextInput accessibilityLabel="Your message" style={styles.input} placeholder="Write a message…" multiline maxLength={4000} value={draft} onChangeText={setDraft} editable={!pending} /><Pressable disabled={pending || !draft.trim()} onPress={send} style={styles.button}><Text style={styles.buttonText}>Send</Text></Pressable></View>}
    </>}
    {pending && <ActivityIndicator color="#55755e" />}{!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#f5f7f1' }, screen: { flex: 1 }, header: { padding: 24 }, eyebrow: { color: '#56755e', fontWeight: '800', letterSpacing: 3, fontSize: 11 }, title: { color: '#1f3328', fontSize: 27, fontWeight: '700', marginTop: 12 }, panel: { padding: 24, gap: 14 }, note: { color: '#52685a', lineHeight: 22, padding: 8 }, input: { flexGrow: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, color: '#26382b', fontSize: 16 }, button: { backgroundColor: '#345c43', borderRadius: 12, padding: 14 }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' }, navigation: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' }, chip: { backgroundColor: '#e2ece1', borderRadius: 12, padding: 10 }, link: { color: '#345c43', fontWeight: '700' }, heading: { color: '#233d2e', fontSize: 20, fontWeight: '700' }, list: { flex: 1 }, messages: { padding: 20, gap: 14 }, bubble: { padding: 16, borderRadius: 18, backgroundColor: '#fff' }, message: { color: '#26382b', fontSize: 16, lineHeight: 23 }, composer: { flexDirection: 'row', gap: 10, padding: 16 }, error: { color: '#a03a37', padding: 16 } });
