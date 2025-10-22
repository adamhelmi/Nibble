// app/_layout.tsx
// Purpose: global navigation layout + default header for the app.
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: 'Nibble',
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,
      }}
    />
  );
}
