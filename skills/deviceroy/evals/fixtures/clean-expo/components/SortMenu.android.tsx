import { useState } from 'react';
import { Host, DropdownMenu, DropdownMenuItem } from '@expo/ui/jetpack-compose';

const OPTIONS = ['Newest', 'Oldest', 'A to Z'];

export function SortMenu() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  return (
    <Host matchContents>
      <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
        {OPTIONS.map((o, i) => (
          <DropdownMenuItem key={o} selected={i === index} onClick={() => { setIndex(i); setOpen(false); }}>{o}</DropdownMenuItem>
        ))}
      </DropdownMenu>
    </Host>
  );
}
