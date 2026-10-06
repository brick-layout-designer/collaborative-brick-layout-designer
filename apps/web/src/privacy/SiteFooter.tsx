// A quiet line at the bottom of Home: the privacy page and About.

import { Link } from 'react-router-dom';

export function SiteFooter() {
  const link = 'tap-target inline-flex items-center hover:text-ink hover:underline';
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-center gap-x-3 border-t border-line pt-4 text-xs text-muted">
      <Link to="/privacy" className={link}>
        Privacy
      </Link>
      <span aria-hidden="true">·</span>
      <Link to="/about" className={link}>
        About
      </Link>
    </footer>
  );
}
