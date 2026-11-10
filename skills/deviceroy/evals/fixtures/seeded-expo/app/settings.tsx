import { useState } from 'react';
import { ActionSheetIOS, Pressable, Text, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

const SORTS = [{ label: 'Newest', value: 'new' }, { label: 'Oldest', value: 'old' }, { label: 'A to Z', value: 'az' }];

export default function Settings() {
  const [sort, setSort] = useState('new');
  const showAccountOptions = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Cancel', 'Export data', 'Sign out'], cancelButtonIndex: 0 },
      (i) => {},
    );
  return (
    <View>
      <Dropdown data={SORTS} labelField="label" valueField="value" value={sort} onChange={(i) => setSort(i.value)} />
      <Pressable onPress={showAccountOptions}><Text>Account options</Text></Pressable>
    </View>
  );
}
