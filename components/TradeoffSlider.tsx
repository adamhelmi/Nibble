// components/TradeoffSlider.tsx
import React from 'react';
import { View, Text, Platform } from 'react-native';
import Slider from '@react-native-community/slider';

type Props = {
  value: number;               // 0..1  (0 = Faster, 1 = Cheaper)
  onChange: (v: number) => void;
};

export default function TradeoffSlider({ value, onChange }: Props) {
  // iOS/Android unified copy
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: '#475569', fontWeight: '700' }}>Faster</Text>
        <Text style={{ color: '#475569', fontWeight: '700' }}>Cheaper</Text>
      </View>
      {/* @ts-ignore: Slider exists in RN core for Expo SDKs; if using @react-native-community/slider, swap import */}
      <Slider
        minimumValue={0}
        maximumValue={1}
        step={0.05}
        value={value}
        onValueChange={onChange}
      />
      <Text style={{ marginTop: 6, color: '#64748b' }}>
        Bias: {value === 0 ? 'Max speed' : value === 1 ? 'Max savings' : `${Math.round(value * 100)}% cost / ${100 - Math.round(value * 100)}% time`}
      </Text>
    </View>
  );
}
