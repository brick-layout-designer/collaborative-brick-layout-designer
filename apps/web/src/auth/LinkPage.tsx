export function LinkPage() {
  // Phase-1 stub. The OAuth callback writes a `cld_pending_link` cookie when
  // the provider's email matches an existing user and asks the user to
  // confirm linking before we attach the provider. The confirm/cancel
  // endpoints land alongside the link UI in a follow-up — for now this page
  // explains the state so we don't silently take over an account.
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-8 text-center">
        <h1 className="text-xl font-semibold">Link this account?</h1>
        <p className="text-sm text-neutral-400">
          This sign-in method's email matches an existing account. Linking
          flows land in the next pass — for now, contact the operator to
          merge accounts.
        </p>
        <a href="/login" className="inline-block text-blue-400 hover:underline">
          back to sign in
        </a>
      </div>
    </div>
  );
}
