// Static "About" page. No auth required so unauthenticated visitors hitting
// the public-share viewer can still read the project blurb / licence /
// issue-reporting info. We DO show the AppHeader when the user is signed
// in, but skip it (and the surrounding nav) when they aren't — same shape
// as the public layout viewer.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { AppHeader } from './AppHeader';

const REPO_URL = 'https://github.com/brick-layout-designer/collaborative-brick-layout-designer';
const ISSUES_URL = `${REPO_URL}/issues`;
const DESKTOP_URL = 'https://github.com/brick-layout-designer/collaborative-brick-layout-designer';
const BLUEBRICK_PARTS_URL = 'https://github.com/Lswbanban/BlueBrickParts';
const ORIGINAL_BLUEBRICK_URL = 'http://bluebrick.lswproject.com/';

export function AboutPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  return (
    <div className="h-full overflow-y-auto p-8 text-neutral-100">
      {me.data?.user ? (
        <AppHeader user={me.data.user} />
      ) : (
        <header className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <Link to="/" className="flex items-center gap-2 text-2xl font-semibold hover:underline">
            <img src="/logo.png" alt="" className="h-8 w-8 rounded" />
            Collaborative Brick Layout Designer
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/login" className="text-neutral-300 hover:underline">
              Sign in
            </Link>
          </nav>
        </header>
      )}

      <main className="mx-auto mt-8 max-w-4xl space-y-8">
        <section>
          <h1 className="text-2xl font-semibold">About</h1>
          <p className="mt-3 text-neutral-300">
            A web port of{' '}
            <a href={DESKTOP_URL} className="text-blue-400 hover:underline">
              Collaborative Brick Layout Designer
            </a>{' '}
            — itself a Qt rebuild of the original{' '}
            <a href={ORIGINAL_BLUEBRICK_URL} className="text-blue-400 hover:underline">
              BlueBrick
            </a>{' '}
            LEGO layout editor by Alban Nanty. This version runs in the
            browser, supports real-time multi-user editing via Yjs, and
            keeps byte-exact <code>.bbm</code> round-trip with the
            desktop save format.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Reporting issues</h2>
          <p className="mt-2 text-sm text-neutral-300">
            Bug reports, feature requests, and "this is wrong, here's
            why" comments are very welcome. File them on the{' '}
            <a href={ISSUES_URL} className="text-blue-400 hover:underline">
              GitHub issue tracker
            </a>
            . For security problems, please don't open a public issue —
            use GitHub's "Report a vulnerability" private form on the
            repository instead.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Links</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>
              <a href={REPO_URL} className="text-blue-400 hover:underline">
                Source code (GitHub)
              </a>
            </li>
            <li>
              <a href={ISSUES_URL} className="text-blue-400 hover:underline">
                Report an issue
              </a>
            </li>
            <li>
              <a href={DESKTOP_URL} className="text-blue-400 hover:underline">
                Desktop CLD (Qt)
              </a>
            </li>
            <li>
              <a href={ORIGINAL_BLUEBRICK_URL} className="text-blue-400 hover:underline">
                Original BlueBrick
              </a>
            </li>
            <li>
              <a href={BLUEBRICK_PARTS_URL} className="text-blue-400 hover:underline">
                BlueBrickParts library
              </a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Licence</h2>
          <p className="mt-2 text-sm text-neutral-300">
            AGPL-3.0-or-later. The bundled BlueBrickParts library is a
            git submodule of the upstream project and retains its
            original licence.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Credits</h2>
          <ul className="mt-2 space-y-1 text-sm text-neutral-300">
            <li>
              <strong>Alban Nanty</strong> — original BlueBrick and the
              <code className="mx-1">.bbm</code> save format.
            </li>
            <li>
              <strong>Lswbanban</strong> and contributors — current
              BlueBrickParts maintenance.
            </li>
            <li>
              <strong>Yjs</strong> — CRDT backend for real-time
              collaboration.
            </li>
            <li>
              <strong>Konva / react-konva</strong> — canvas rendering.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
