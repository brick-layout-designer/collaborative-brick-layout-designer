// Admin › Heavy use: top people and clubs; opening one shows its detail.

import { useState } from 'react';
import { HeavyUseTab } from '../limits/LimitsUi';
import { UserDetailPanel } from './UsersTab';
import { OrgDetailPanel } from './ClubsTab';

export function HeavyUse() {
  const [open, setOpen] = useState<{ kind: 'user' | 'org'; id: string } | null>(null);
  if (open) {
    return open.kind === 'user' ? (
      <UserDetailPanel id={open.id} onBack={() => setOpen(null)} />
    ) : (
      <OrgDetailPanel id={open.id} onBack={() => setOpen(null)} />
    );
  }
  return <HeavyUseTab onOpen={(kind, id) => setOpen({ kind, id })} />;
}
