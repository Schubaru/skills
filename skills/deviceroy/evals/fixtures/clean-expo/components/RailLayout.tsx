import { Slot } from 'expo-router';
import { View } from 'react-native';
import { NavigationRail } from './NavigationRail';

// 600dp+: a navigation rail beside the content (Android 17 large screens).
export function RailLayout() {
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <NavigationRail items={[{ name: 'index', label: 'Home' }, { name: 'profile', label: 'Profile' }]} />
      <Slot />
    </View>
  );
}
