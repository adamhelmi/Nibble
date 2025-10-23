// app.config.js
import 'dotenv/config';

export default {
  expo: {
    name: 'Nibble',
    slug: 'nibble',
    scheme: 'nibble',
    plugins: ['expo-router'],
    extra: {
      EXPO_PUBLIC_LLAMA_URL:
        process.env.EXPO_PUBLIC_LLAMA_URL || 'http://192.168.1.12:11434',
      EXPO_PUBLIC_PRICING_URL:
        process.env.EXPO_PUBLIC_PRICING_URL || 'http://localhost:5057',
      EXPO_PUBLIC_DEFAULT_ZIP:
        process.env.EXPO_PUBLIC_DEFAULT_ZIP || '45202',
    },
    android: {
      // Ensures the screen resizes so the input isn't hidden by the keyboard
      windowSoftInputMode: 'adjustResize',
    },
  },
};
