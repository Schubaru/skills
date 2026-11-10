import { useState } from 'react';
import { Host, Picker } from '@expo/ui/swift-ui';

const OPTIONS = ['Newest', 'Oldest', 'A to Z'];

export function SortMenu() {
  const [index, setIndex] = useState(0);
  return (
    <Host matchContents>
      <Picker variant="menu" options={OPTIONS} selectedIndex={index} onOptionSelected={({ nativeEvent }) => setIndex(nativeEvent.index)} />
    </Host>
  );
}
