import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';

/**
 * Invite-acceptance landing. Three states:
 *
 *   1. Not signed in → show "Sign in to accept" with the inviter's email
 *      pre-filled. The user is redirected back here after auth.
 *   2. Signed in as the wrong user → 403 from accept; offer to sign out.
 *   3. Signed in as the right user → POST /api/invites/:token automatically;
 *      redirect to /editor/:layoutId.
 */
export function InvitePage() {
  const params = useParams<{ token: string }>();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const preview = useQuery({
    queryKey: ['invite-preview', params.token],
    queryFn: () => api.invites.preview(params.token!),
    enabled: !!params.token,
  });
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => api.invites.accept(params.token!),
    onSuccess: (res) => {
      setAccepted(true);
      // Brief pause so the user sees "joined!" before the editor mounts.
      setTimeout(() => navigate(`/editor/${res.layoutId}`), 600);
    },
    onError: (e: Error) => setAcceptError(e.message),
  });

  // Auto-accept once we know the user is signed in with the matching email.
  useEffect(() => {
    if (
      preview.data &&
      me.data?.user &&
      me.data.user.email.toLowerCase() === preview.data.invitedEmail.toLowerCase() &&
      !accept.isPending &&
      !accept.isSuccess &&
      !accept.isError
    ) {
      accept.mutate();
    }
  }, [preview.data, me.data, accept]);

  if (!params.token) return <Navigate to="/" replace />;

  if (preview.isLoading || me.isLoading)
    return <Centered>Loading invite…</Centered>;

  if (preview.isError) {
    return (
      <Centered>
        <Alert
          tone="error"
          title="This invite isn't valid."
          body={(preview.error as Error).message ?? 'Unknown error'}
        />
      </Centered>
    );
  }

  const inv = preview.data!;
  const isSignedIn = !!me.data?.user;
  const wrongUser =
    isSignedIn && me.data!.user!.email.toLowerCase() !== inv.invitedEmail.toLowerCase();

  if (accepted) {
    return <Centered>Joined! Opening the editor…</Centered>;
  }

  return (
    <Centered>
      <div className="w-full max-w-md space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-lg font-semibold">You're invited</h1>
        <p className="text-sm text-neutral-400">
          You've been invited to <strong>{inv.layoutTitle}</strong> as a {inv.role}.
        </p>

        {!isSignedIn && (
          <>
            <p className="text-sm text-neutral-300">
              Sign in as <strong>{inv.invitedEmail}</strong> to accept.
            </p>
            <Link
              to={`/login?next=${encodeURIComponent(`/invite/${params.token}`)}`}
              className="block rounded bg-blue-600 px-4 py-2 text-center hover:bg-blue-500"
            >
              Sign in
            </Link>
          </>
        )}

        {wrongUser && (
          <Alert
            tone="warn"
            title="This invite is for a different account."
            body={
              <>
                The invite is for <strong>{inv.invitedEmail}</strong>, but
                you're signed in as <strong>{me.data!.user!.email}</strong>.
                Sign out and back in with the matching email.
              </>
            }
          />
        )}

        {acceptError && (
          <Alert
            tone="error"
            title="Couldn't accept the invite."
            body={acceptError}
          />
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center px-4">{children}</div>;
}

function Alert({
  tone,
  title,
  body,
}: {
  tone: 'error' | 'warn';
  title: string;
  body: React.ReactNode;
}) {
  const colour =
    tone === 'error'
      ? 'border-red-900 bg-red-950/30 text-red-300'
      : 'border-amber-900 bg-amber-950/30 text-amber-200';
  return (
    <div className={`rounded border ${colour} p-3 text-sm`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs">{body}</p>
    </div>
  );
}
