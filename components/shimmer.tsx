// components/Shimmer.tsx
import React, { useRef, useEffect } from 'react';
import { Animated, ViewStyle } from 'react-native';

export default function Shimmer({ height = 80, radius = 14, style }: { height?: number; radius?: number; style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ height, borderRadius: radius, backgroundColor: '#e5e7eb', marginVertical: 8, opacity }, style]} />;
}
