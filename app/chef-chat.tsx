// app/chef-chat.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  LayoutChangeEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { AI, type ChatMessage } from '../lib/ai';
import { useToast } from '../hooks/useToast';
import { usePing } from '../hooks/usePing';
import { analyticalReply } from '../lib/mathEngine';
import {
  ensurePrefsLoaded,
  getPrefs,
  updatePrefs,
  resetPrefs,            // ⬅️ NEW
  useUpdatePrefs,
  type Prefs,
} from '../lib/prefs';
import { extractPrefsFromText, chipsForPrefs } from '../lib/prefsNLP';

const STORAGE_KEY = 'nibble-chef-thread-v1';

// Tweak this to tune the tiny visual gap between the composer and keyboard
const FLOAT_GAP = 6; // dp

function isPrefsEmpty() {
  const p = getPrefs();
  const hasDiet = p.diet && p.diet !== 'omnivore';
  const hasReligious = p.religious && p.religious !== 'none';
  const hasAllergens = (p.allergens ?? []).length > 0;
  const hasDislikes = (p.dislikes ?? []).length > 0;
  return !(hasDiet || hasReligious || hasAllergens || hasDislikes);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// Merge two Partial<Prefs> patches with the rules:
// - diet/religious: b overrides a if provided
// - allergens/dislikes: union + dedupe
function mergePrefPatches(
  a: Partial<Prefs> | null | undefined,
  b: Partial<Prefs> | null | undefined
): Partial<Prefs> {
  const A = a ?? {};
  const B = b ?? {};
  const merged: Partial<Prefs> = { ...A };

  // Scalars: prefer newest if present
  if (B.diet) merged.diet = B.diet;
  if (B.religious) merged.religious = B.religious;
  if (B.preferredUnits) merged.preferredUnits = B.preferredUnits;
  if (typeof B.spiceTolerance !== 'undefined') merged.spiceTolerance = B.spiceTolerance;
  if (B.zip) merged.zip = B.zip;

  // Arrays: union + dedupe
  const allergens = uniq([...(A.allergens ?? []), ...(B.allergens ?? [])]);
  if (allergens.length) merged.allergens = allergens;

  const dislikes = uniq([...(A.dislikes ?? []), ...(B.dislikes ?? [])]);
  if (dislikes.length) merged.dislikes = dislikes;

  return merged;
}

export default function ChefChatScreen() {
  // Start without a system message — ai.ts injects a prefs-aware system header automatically.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { show, ToastElement } = useToast();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const { ok, checking, pingNow } = usePing();

  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const updatePrefsHook = useUpdatePrefs(); // dev/demo shortcut remains

  // Pending preference capture (inline Save/Not now) — now accumulative
  const [pendingPrefs, setPendingPrefs] = useState<Partial<Prefs> | null>(null);
  const [pendingChips, setPendingChips] = useState<string[]>([]);
  const [askedForPrefs, setAskedForPrefs] = useState(false);

  // measure composer height (so we can lightly pad the list, avoiding overlap on very short screens)
  const [composerH, setComposerH] = useState(56);
  const onComposerLayout = (e: LayoutChangeEvent) => {
    const h = Math.max(48, Math.round(e.nativeEvent.layout.height));
    if (h !== composerH) setComposerH(h);
  };

  // Load prefs + saved thread on mount, then optionally ask for restrictions
  useEffect(() => {
    (async () => {
      try {
        await ensurePrefsLoaded();
      } catch {}
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ChatMessage[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessages(parsed);
          }
        }
      } catch {}
    })();
  }, []);

  // On first render after prefs/thread load, prompt for restrictions if empty & not asked
  useEffect(() => {
    if (!askedForPrefs && messages.length === 0) {
      const empty = isPrefsEmpty();
      if (empty) {
        setAskedForPrefs(true);
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content:
            "Before we start — do you have any dietary or religious restrictions I should follow (vegan, vegetarian, pescatarian, halal, kosher)? Any allergens or hard no’s (e.g., peanuts, dairy, cilantro)?",
        };
        setMessages([assistantMsg]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, askedForPrefs]);

  // Persist on every change + auto scroll
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 9e6, animated: true });
    });
  }, [messages]);

  const handleDetectedPrefs = (text: string) => {
    const extracted = extractPrefsFromText(text);
    if (!extracted.found) return;

    // Merge new detection into any existing pending prefs
    setPendingPrefs(prev => mergePrefPatches(prev, extracted.patch));
    setPendingChips(prev => uniq([...(prev ?? []), ...extracted.chips]));

    // Non-blocking toast to indicate detection
    show('Detected preferences — review and Save above.');
  };

  const savePendingPrefs = async () => {
    if (!pendingPrefs) return;
    try {
      await updatePrefs(pendingPrefs);
      const chips = chipsForPrefs(getPrefs());
      setPendingPrefs(null);
      setPendingChips([]);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Saved: ${chips.join(' • ')}. I’ll follow these rules going forward.`,
        },
      ]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      show('Failed to save preferences');
    }
  };

  const dismissPendingPrefs = () => {
    setPendingPrefs(null);
    setPendingChips([]);
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content:
          "Got it. I won’t save those to your profile. I’ll still try to respect them in this conversation.",
      },
    ]);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const userMsg: ChatMessage = { role: 'user', content: text };

    setInput('');
    setMessages(prev => [...prev, userMsg]);

    // Detect prefs expressed in natural language; offer Save/Not now banner (accumulative)
    try {
      handleDetectedPrefs(text);
    } catch {
      // ignore detection failures
    }

    // Try deterministic Analytical Mode first
    try {
      const analytic = analyticalReply(text);
      if (analytic) {
        const assistantMsg: ChatMessage = { role: 'assistant', content: analytic };
        setMessages(prev => [...prev, assistantMsg]);
        return;
      }
    } catch {
      // fall through to AI
    }

    setLoading(true);
    try {
      const replyText = await AI.chatOllama([...messages, userMsg]);
      const assistantMsg: ChatMessage = { role: 'assistant', content: replyText };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      show(`AI error: ${msg}`);
      const errMsg: ChatMessage = { role: 'assistant', content: `Error: ${msg}` };
      setMessages(prev => [...prev, errMsg]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0B0D0F' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      // Correct offset = native header height; avoids double-padding or clipping on iOS.
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 12 }}>
        <Text style={{ color: '#E6E9EF', fontSize: 22, fontWeight: '700', marginBottom: 8 }}>
          Chef Nibble
        </Text>

        {/* Status + Refresh + tiny Dev toggles */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              backgroundColor: ok === true ? '#22c55e' : ok === false ? '#ef4444' : '#f59e0b',
            }}
          />
          <Text style={{ marginLeft: 6, color: '#8FA3B8' }}>
            {ok === true ? 'Local AI online' : ok === false ? 'AI offline' : 'Checking…'}
          </Text>
          <TouchableOpacity onPress={pingNow} style={{ marginLeft: 10 }}>
            <Text style={{ color: '#3E7BFA', fontWeight: '600' }}>
              {checking ? '…' : 'Refresh'}
            </Text>
          </TouchableOpacity>

          {/* Dev-only: quick vegan toggle remains for demos */}
          <TouchableOpacity
            onPress={() => updatePrefsHook({ diet: 'vegan', allergens: ['dairy'] })}
            style={{ marginLeft: 10 }}
          >
            <Text style={{ color: '#10b981', fontWeight: '600' }}>Dev: Vegan</Text>
          </TouchableOpacity>

          {/* NEW: Dev Reset to defaults */}
          <TouchableOpacity
            onPress={async () => {
              await resetPrefs();
              show('Preferences reset to defaults.');
            }}
            style={{ marginLeft: 10 }}
          >
            <Text style={{ color: '#ef4444', fontWeight: '600' }}>Dev: Reset</Text>
          </TouchableOpacity>
        </View>

        {/* Inline preference confirmation banner (accumulative) */}
        {pendingPrefs && pendingChips.length > 0 && (
          <View
            style={{
              backgroundColor: '#12202B',
              borderColor: '#1F3A4D',
              borderWidth: 1,
              padding: 10,
              borderRadius: 10,
              marginBottom: 8,
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <Text style={{ color: '#A7C7E7', marginRight: 6 }}>Save preferences:</Text>
            {pendingChips.map((c, i) => (
              <View
                key={i}
                style={{
                  backgroundColor: '#1B2A36',
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: 999,
                  marginRight: 6,
                  marginBottom: 6,
                }}
              >
                <Text style={{ color: '#CDE4FF', fontSize: 12 }}>{c}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', marginLeft: 'auto', gap: 8 }}>
              <TouchableOpacity
                onPress={savePendingPrefs}
                style={{ backgroundColor: '#3E7BFA', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}
              >
                <Text style={{ color: 'white', fontWeight: '600' }}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={dismissPendingPrefs}
                style={{ backgroundColor: '#2A3340', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}
              >
                <Text style={{ color: '#C9D3DE', fontWeight: '600' }}>Not now</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Messages */}
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={messages.filter(m => m.role !== 'system')}
          keyExtractor={(_, i) => String(i)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 8 }}
          onContentSizeChange={() =>
            listRef.current?.scrollToOffset({ offset: 9e6, animated: true })
          }
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: item.role === 'user' ? '#1B2430' : '#14181D',
                padding: 10,
                borderRadius: 12,
                marginVertical: 6,
              }}
            >
              <Text style={{ color: '#8FA3B8', fontSize: 12 }}>
                {item.role === 'user' ? 'You' : 'Chef Nibble'}
              </Text>
              <Text style={{ color: '#E6E9EF', fontSize: 16 }}>{item.content}</Text>
            </View>
          )}
          ListFooterComponent={loading ? <ActivityIndicator /> : null}
        />

        {/* Floating composer with a minimal gap above the keyboard */}
        <View
          onLayout={onComposerLayout}
          style={{
            flexDirection: 'row',
            gap: 8,
            marginTop: 8,
            marginBottom:
              (Platform.OS === 'ios' ? insets.bottom : Math.max(insets.bottom, 0)) + FLOAT_GAP,
          }}
        >
          <TextInput
            style={{
              flex: 1,
              backgroundColor: '#14181D',
              color: 'white',
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
            placeholder="Ask the chef..."
            placeholderTextColor="#777"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
          />
          <TouchableOpacity
            onPress={sendMessage}
            disabled={loading}
            style={{
              backgroundColor: loading ? '#94a3b8' : '#3E7BFA',
              borderRadius: 12,
              paddingHorizontal: 16,
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '600' }}>
              {loading ? 'Sending…' : 'Send'}
            </Text>
          </TouchableOpacity>
        </View>

        {ToastElement}
      </View>
    </KeyboardAvoidingView>
  );
}

