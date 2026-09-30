// Settings: light or dark, colour, bigger text and help
// icons. Signed in, they're stored on the account on this server (named
// by window.location.host, since every club runs its own); signed out,
// in this browser only. Used as a page (/settings) and as a dialog over
// the editor, so changing the look doesn't mean leaving a layout.

import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePreferences } from '../theme/PrefsProvider';
import { ACCENTS, ACCENT_IDS, NEUTRALS } from '../theme/tokens';
import type { ThemeChoice } from '../theme/theme';
import { HelpButton } from '../help/HelpButton';
import type { HelpKey } from '../help/helpTexts';

const THEME_CARDS: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Match my computer' },
];

function ThemePreview({ id }: { id: ThemeChoice }) {
  if (id === 'system') {
    return (
      <div className="flex h-14 sm:h-[90px] overflow-hidden rounded-control border border-line" aria-hidden>
        <div className="grow" style={{ background: NEUTRALS.light.bg }} />
        <div className="grow" style={{ background: NEUTRALS.dark.bg }} />
      </div>
    );
  }
  const n = NEUTRALS[id];
  return (
    <div className="flex h-14 sm:h-[90px] gap-1.5 rounded-control border border-line p-2" style={{ background: n.bg }} aria-hidden>
      <div className="w-[22%] rounded-md" style={{ background: n.panel }} />
      <div className="grow rounded-md" style={{ background: n.gridLine }} />
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent text-accent-ink' : 'bg-border'}`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] ${checked ? 'left-7' : 'left-1'}`}
      />
    </button>
  );
}

function Section({ id, title, help, children }: { id: string; title: string; help?: HelpKey; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-4 rounded-section border border-line bg-panel p-6">
      <div className="flex items-center gap-2">
        <h2 id={`${id}-title`} className="font-display text-xl font-bold">
          {title}
        </h2>
        {help && <HelpButton helpKey={help} target={`#${id}`} />}
      </div>
      {children}
    </section>
  );
}

export function SettingsContent({ onClose }: { onClose?: () => void }) {
  const { prefs, setPrefs, syncedToAccount } = usePreferences();
  const host = window.location.host;

  return (
    <div className="flex flex-col gap-8 md:flex-row">
      <nav aria-label="Settings sections" className="flex shrink-0 flex-col gap-1 md:w-56">
        <h1 className="mb-4 font-display text-3xl font-bold">Settings</h1>
        <a href="#look" className="rounded-control border border-line bg-panel px-3 py-2.5 font-bold text-ink">
          Look and feel
        </a>
        <a href="#help" className="rounded-control px-3 py-2.5 font-semibold text-muted hover:bg-soft">
          Help and tours
        </a>
        <a href="#account" className="rounded-control px-3 py-2.5 font-semibold text-muted hover:bg-soft">
          Account
        </a>
        <div
          className={`mt-6 flex flex-col gap-2 rounded-card p-3 text-[13px] leading-snug ${syncedToAccount ? 'bg-ok-soft text-ok' : 'bg-soft text-muted'}`}
          data-testid="settings-sync-note"
        >
          {syncedToAccount ? (
            <>
              <div className="flex items-center gap-1.5 font-bold">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5" />
                  <path d="M18 3v4h-4M6 21v-4h4" />
                </svg>
                Synced with {host}
                <HelpButton helpKey="settings.sync" target='[data-testid="settings-sync-note"]' />
              </div>
              <div>These settings follow your account, so they're the same wherever you sign in to {host}.</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 font-bold">
                Saved in this browser
                <HelpButton helpKey="settings.sync" target='[data-testid="settings-sync-note"]' />
              </div>
              <div>Sign in to keep these settings with your account.</div>
            </>
          )}
        </div>
      </nav>

      <div className="flex min-w-0 grow flex-col gap-5">
        <Section id="look" title="Light or dark">
          <div className="grid grid-cols-3 gap-2 sm:gap-3.5" role="radiogroup" aria-label="Light or dark">
            {THEME_CARDS.map((t) => {
              const on = prefs.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPrefs({ theme: t.id })}
                  className={`flex flex-col gap-2.5 rounded-bubble bg-panel p-2.5 text-left ${on ? 'border-2 border-accent' : 'border border-border hover:border-muted'}`}
                >
                  <ThemePreview id={t.id} />
                  <span className="text-sm font-bold text-ink">{t.label}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section id="colour" title="Colour" help="settings.colour">
          <div className="flex flex-wrap gap-5" role="radiogroup" aria-label="Colour">
            {ACCENT_IDS.map((id) => {
              const a = ACCENTS[id];
              const on = prefs.accent === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={a.label}
                  onClick={() => setPrefs({ accent: id })}
                  className={`flex w-20 flex-col items-center gap-2 text-[13px] ${on ? 'font-bold text-ink' : 'font-semibold text-muted'}`}
                >
                  <span
                    className="h-11 w-11 rounded-full"
                    style={{
                      background: a.main,
                      boxShadow: on ? `0 0 0 3px var(--panel), 0 0 0 5px ${a.main}` : undefined,
                    }}
                  />
                  {a.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold">
              <input
                type="checkbox"
                className="h-5 w-5 accent-accent"
                checked={prefs.largeText}
                onChange={(e) => setPrefs({ largeText: e.target.checked })}
              />
              Bigger text and buttons
            </label>
            <HelpButton helpKey="settings.largeText" />
          </div>
        </Section>

        <Section id="help" title="Help and tours">
          <div className="flex items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                Show help buttons
                <HelpButton helpKey="settings.helpIcons" target='[role="switch"][aria-label="Show help buttons"]' />
              </div>
              <div className="text-sm text-muted">The small round question marks next to panel titles and settings.</div>
            </div>
            <Switch label="Show help buttons" checked={prefs.helpIcons} onChange={(v) => setPrefs({ helpIcons: v })} />
          </div>
          <div className="flex items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                Tours
                <HelpButton helpKey="settings.tours" />
              </div>
              <div className="text-sm text-muted">
                {prefs.toursSeen.length === 0 ? "You haven't finished any tours yet." : `You've seen ${prefs.toursSeen.length === 1 ? 'one tour' : `${prefs.toursSeen.length} tours`}.`}
              </div>
            </div>
            <button
              type="button"
              disabled={prefs.toursSeen.length === 0}
              onClick={() => setPrefs({ toursSeen: [] })}
              className="h-10 shrink-0 rounded-control border border-border px-4 text-sm font-semibold hover:bg-soft disabled:opacity-50"
            >
              Show tours again
            </button>
          </div>
        </Section>

        <Section id="account" title="Account">
          {syncedToAccount ? (
            <p className="text-[15px] text-muted">
              Your name, sign-in methods and connected desktop apps are on your{' '}
              <Link to="/profile" onClick={onClose} className="font-semibold text-accent-text underline">
                profile page
              </Link>
              .
            </p>
          ) : (
            <p className="text-[15px] text-muted">
              <Link to="/login" onClick={onClose} className="font-semibold text-accent-text underline">
                Sign in
              </Link>{' '}
              to keep your settings with your account.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

/** /settings as its own page. */
export function SettingsPage() {
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-y-auto bg-bg px-4 py-8 text-ink sm:px-16 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="mb-6 text-sm font-semibold text-muted hover:text-ink"
        >
          ← Back
        </button>
        <SettingsContent />
      </div>
    </div>
  );
}

/** Settings over the editor, closed with Escape or the Close button. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Settings" className="relative max-h-full w-full max-w-5xl overflow-y-auto rounded-section bg-bg p-6 text-ink shadow-pop sm:p-10">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 h-10 rounded-control border border-border bg-panel px-4 text-sm font-semibold hover:bg-soft"
        >
          Close
        </button>
        <SettingsContent onClose={onClose} />
      </div>
    </div>
  );
}
