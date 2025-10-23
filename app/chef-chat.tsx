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
  Keyboard,
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

const STORAGE_KEY = 'nibble-chef-thread-v1';

export default function ChefChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'system',
      content:
        'You are Chef Nibble. Be concise; stick to cooking, meal planning, ingredients. Return short steps and note allergens.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { show, ToastElement } = useToast();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const { ok, checking, pingNow } = usePing();

  // Insets + header height so KeyboardAvoidingView can offset correctly.
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  // Measure composer height (so list gets exact bottom padding).
  const [composerH, setComposerH] = useState(56);
  const onComposerLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h && h !== composerH) setComposerH(h);
  };

  // ── Load saved thread ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ChatMessage[];
          if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
        }
      } catch {}
    })();
  }, []);

  // ── Persist & auto-scroll ───────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 9e6, animated: true });
    });
  }, [messages]);

  // Keep list pinned to bottom when keyboard changes height.
  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', () =>
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 9e6, animated: true })),
    );
    const onFrame = Keyboard.addListener('keyboardDidChangeFrame', () =>
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 9e6, animated: true })),
    );
    return () => {
      onShow.remove();
      onFrame.remove();
    };
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const userMsg: ChatMessage = { role: 'user', content: text };

    setInput('');
    setMessages(prev => [...prev, userMsg]);

    // Try deterministic analytical mode first; fall back to AI if not handled.
    try {
      const analytic = analyticalReply(text);
      if (analytic) {
        const assistantMsg: ChatMessage = { role: 'assistant', content: analytic };
        setMessages(prev => [...prev, assistantMsg]);
        return;
      }
    } catch {
      // ignore and continue to AI
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
      // Use the real header height so the avoided area is exact.
      keyboardVerticalOffset={Platform.select({ ios: headerHeight, android: 0 })}
    >
      <View style={{ flex: 1, paddingTop: 12, paddingHorizontal: 12 }}>
        <Text style={{ color: '#E6E9EF', fontSize: 22, fontWeight: '700', marginBottom: 8 }}>
          Chef Nibble
        </Text>

        {/* Status pill + refresh */}
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
            <Text style={{ color: '#3E7BFA', fontWeight: '600' }}>{checking ? '…' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={messages.filter(m => m.role !== 'system')}
          keyExtractor={(_, i) => String(i)}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{
            // Keep last message visible above the pinned composer
            paddingBottom: composerH + insets.bottom + 12,
          }}
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

        {/* Composer pinned to safe-area bottom */}
        <View
          onLayout={onComposerLayout}
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: insets.bottom + 8,
            flexDirection: 'row',
            gap: 8,
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
