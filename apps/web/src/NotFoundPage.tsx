// Any address the app doesn't know: say so, with a way back, rather than
// an empty page.

import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-8 text-center text-ink">
      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">This link doesn’t go anywhere here. It may be mistyped, or from an older version of the site.</p>
        <Link to="/" className="tap-target mt-4 inline-flex items-center text-sm font-semibold text-accent-text hover:underline">
          Go to Home
        </Link>
      </div>
    </div>
  );
}
