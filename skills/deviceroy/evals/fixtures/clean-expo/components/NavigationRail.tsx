import { Link } from 'expo-router';
import { View } from 'react-native';

export function NavigationRail({ items }: { items: { name: string; label: string }[] }) {
  return (
    <View style={{ width: 80, paddingTop: 12, gap: 12 }}>
      {items.map((i) => <Link key={i.name} href={`/${i.name === 'index' ? '' : i.name}`}>{i.label}</Link>)}
    </View>
  );
}
