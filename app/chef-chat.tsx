// app/chef-chat.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { AI, type ChatMessage } from '../lib/ai';
import { useToast } from '../hooks/useToast';
import { usePing } from '../hooks/usePing'; // ⬅️ NEW

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
  const { ok, checking, pingNow } = usePing(); // ⬅️ NEW

  // Load saved thread on mount
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

  // Persist on every change + auto scroll
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
    // auto-scroll to end
    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 999999, animated: true });
    }, 0);
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const userMsg: ChatMessage = { role: 'user', content: text };

    setInput('');
    setMessages(prev => [...prev, userMsg]);
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
    <View style={{ flex: 1, padding: 12, backgroundColor: '#0B0D0F' }}>
      <Text style={{ color: '#E6E9EF', fontSize: 22, fontWeight: '700', marginBottom: 8 }}>Chef Nibble</Text>

      {/* Status pill + refresh */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <View
          style={{
            width: 8, height: 8, borderRadius: 999,
            backgroundColor: ok === true ? '#22c55e' : ok === false ? '#ef4444' : '#f59e0b'
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
      </View>

      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        data={messages.filter(m => m.role !== 'system')}
        keyExtractor={(_, i) => String(i)}
        onContentSizeChange={() => listRef.current?.scrollToOffset({ offset: 999999, animated: true })}
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

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TextInput
          style={{
            flex: 1,
            backgroundColor: '#14181D',
            color: 'white',
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
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
          style={{ backgroundColor: loading ? '#94a3b8' : '#3E7BFA', borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '600' }}>{loading ? 'Sending…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>

      {ToastElement}
    </View>
  );
}
