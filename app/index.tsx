// app/index.tsx
import { Link } from 'expo-router';
import { View, Text } from 'react-native';

export default function Home() {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 24 }}>
        👋 Welcome to Nibble
      </Text>
      <Text style={{ marginTop: 8, color: '#555' }}>
        Scan your pantry, get recipes, track budget & rewards.
      </Text>

      <View style={{ marginTop: 24 }}>
        <Link href="/scan" style={{ color: '#2563eb', fontWeight: '700', fontSize: 18 }}>
          → Scan fridge
        </Link>

        <Link
          href="/recipes"
          style={{ color: '#2563eb', fontWeight: '700', fontSize: 18, marginTop: 12 }}
        >
          → Recipes
        </Link>

        <Link
          href="/planner"
          style={{ color: '#2563eb', fontWeight: '700', fontSize: 18, marginTop: 12 }}
        >
          → Meal planner
        </Link>

        <Link
          href="/chef-chat"
          style={{ color: '#2563eb', fontWeight: '700', fontSize: 18, marginTop: 12 }}
        >
          → Chef Chat
        </Link>

        <Link
          href="/rewards"
          style={{ color: '#2563eb', fontWeight: '700', fontSize: 18, marginTop: 12 }}
        >
          → Rewards
        </Link>
      </View>
    </View>
  );
}
