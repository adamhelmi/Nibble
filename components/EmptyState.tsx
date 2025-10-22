// components/EmptyState.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { T } from '../lib/ui';

export default function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ padding: 16, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center' }}>
      <Text style={[T.h2]}>{title}</Text>
      {!!subtitle && <Text style={{ marginTop: 6, color: '#6b7280', textAlign: 'center' }}>{subtitle}</Text>}
    </View>
  );
}
