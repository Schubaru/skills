import { Switch, Text, View } from 'react-native';
import { useState } from 'react';

export default function Filters() {
  const [unread, setUnread] = useState(false);
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text>Only unread</Text>
      <Switch value={unread} onValueChange={setUnread} accessibilityLabel="Only unread" />
    </View>
  );
}
