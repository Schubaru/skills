import { Stack, router } from 'expo-router';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={24} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
