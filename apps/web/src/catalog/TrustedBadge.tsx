// "Trusted club": shared by a club the site trusts to review what's
// published under its own name.

export function TrustedBadge() {
  return (
    <span
      data-testid="trusted-badge"
      title="A trusted club: its own admins and managers check what it shares"
      className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent-text"
    >
      <svg aria-hidden width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 12l5 5L20 7" />
      </svg>
      Trusted club
    </span>
  );
}
