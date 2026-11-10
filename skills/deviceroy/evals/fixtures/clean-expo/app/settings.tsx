import { Alert, Switch, Text, View, Pressable } from 'react-native';
import { useState } from 'react';

export default function Settings() {
  const [on, setOn] = useState(true);
  const signOut = () =>
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => {} },
    ]);
  return (
    <View>
      <Switch value={on} onValueChange={setOn} />
      <Pressable onPress={signOut}><Text>Sign out</Text></Pressable>
    </View>
  );
}
