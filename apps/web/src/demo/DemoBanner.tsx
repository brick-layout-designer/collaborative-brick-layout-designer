// "This is a demo. Everything resets every day (next reset in 3 h)." A
// small bar shown to whoever is signed in to the demo account. The reset
// time comes from /api/auth/me, which refetches when a reset happens.
// Clicks pass through it, so it never covers a button.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { RESET_EVERY_TEXT, timeUntil } from './demoText';

export function DemoBanner() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  // Only the demo account's /me carries `demo`.
  const demo = me.data?.user?.demo;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!demo) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [demo]);
  if (!demo) return null;
  const next = demo.nextResetAt === null ? '' : ` (next reset in ${timeUntil(demo.nextResetAt, now)})`;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.25rem,env(safe-area-inset-top))] z-50 flex justify-center px-4">
      <p
        role="status"
        data-testid="demo-banner"
        className="rounded-full border border-line bg-panel/95 px-3 py-1 text-xs text-ink shadow-pop"
      >
        This is a demo. Everything resets {RESET_EVERY_TEXT[demo.resetEvery]}{next}.
      </p>
    </div>
  );
}
