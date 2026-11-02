import { Link } from 'expo-router';
import { Text, ScrollView } from 'react-native';
import { SortMenu } from '../../components/SortMenu';

export default function Home() {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <Text>Welcome back</Text>
      <SortMenu />
      <Link href="/settings">Settings</Link>
    </ScrollView>
  );
}
