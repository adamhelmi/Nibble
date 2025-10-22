// components/toast.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, View, Text } from 'react-native';

export default function Toast({ visible, message }: { visible: boolean; message: string }) {
  const y = useRef(new Animated.Value(40)).current;
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(y, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(y, { toValue: 40, duration: 160, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, y, op]);

  // Always render; animation handles visibility
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 24,
        transform: [{ translateY: y }],
        opacity: op,
      }}
    >
      <View style={{ backgroundColor: '#111827', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 }}>
        <Text style={{ color: 'white', fontWeight: '700' }}>Heads up</Text>
        <Text style={{ color: '#cbd5e1', marginTop: 4 }}>{message}</Text>
      </View>
    </Animated.View>
  );
}
