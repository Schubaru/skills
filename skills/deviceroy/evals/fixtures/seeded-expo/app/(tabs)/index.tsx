import { Stack, Link } from 'expo-router';
import { Pressable, Text, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function Home() {
  return (
    <ScrollView>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <Pressable accessibilityLabel="Search"><Ionicons name="search" size={22} /></Pressable>
              <Pressable accessibilityLabel="Share"><Ionicons name="share-outline" size={22} /></Pressable>
              <Pressable accessibilityLabel="Filter"><Ionicons name="filter" size={22} /></Pressable>
              <Pressable accessibilityLabel="Notifications"><Ionicons name="notifications" size={22} /></Pressable>
              <Pressable accessibilityLabel="More"><Ionicons name="ellipsis-horizontal" size={22} /></Pressable>
            </View>
          ),
        }}
      />
      <Text style={{ fontSize: 17 }}>Welcome back</Text>
      <Link href="/settings">Settings</Link>
    </ScrollView>
  );
}
