// /privacy: the site's privacy notice, written by whoever runs it (Admin ›
// Settings › Privacy), who to ask, and what anyone can do themselves
// (download their data, delete their account). Open to everyone, signed in
// or not.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api';
import { Markdown } from './Markdown';

export interface PrivacyInfo {
  notice: string | null;
  contact: string | null;
}

export const fetchPrivacy = () => apiGet<PrivacyInfo>('/api/privacy');

export function contactHref(contact: string): string {
  return contact.includes('@') && !contact.includes('://') ? `mailto:${contact}` : contact;
}

export function PrivacyPage() {
  const q = useQuery({ queryKey: ['privacy-page'], queryFn: fetchPrivacy });
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 text-ink sm:p-8">
      <Link to="/" className="text-sm text-accent-text hover:underline">
        ← Home
      </Link>
      <h1 className="font-display text-2xl font-semibold">Privacy</h1>
      {q.isLoading && <p className="text-muted">Loading…</p>}
      {q.data && (
        <>
          {q.data.notice ? (
            <article data-testid="privacy-notice">
              <Markdown source={q.data.notice} />
            </article>
          ) : (
            <p className="text-muted">The people who run this site haven’t written their privacy notice yet.</p>
          )}
          <section className="space-y-2 rounded-lg border border-line p-4 text-sm">
            <h2 className="font-semibold">Your data, your choice</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <Link to="/profile#my-data" className="text-accent-text hover:underline">
                  Download your data
                </Link>
                : everything this site keeps about you, in one file.
              </li>
              <li>
                <Link to="/profile#delete-account" className="text-accent-text hover:underline">
                  Delete your account
                </Link>
                : it waits a while first, so you can change your mind.
              </li>
              <li>To correct something, or ask anything else about your data, contact the people who run this site.</li>
            </ul>
            {q.data.contact && (
              <p data-testid="privacy-contact">
                Contact:{' '}
                <a href={contactHref(q.data.contact)} className="text-accent-text hover:underline">
                  {q.data.contact}
                </a>
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
