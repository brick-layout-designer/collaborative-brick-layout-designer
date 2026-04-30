import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';

/**
 * /org-invite/:token landing — same shape as the layout-invite page,
 * but for joining an org. Auto-accepts when the signed-in user's email
 * matches; otherwise prompts to sign in or surfaces an email-mismatch
 * notice.
 */
export function OrgInvitePage() {
  const params = useParams<{ token: string }>();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const preview = useQuery({
    queryKey: ['org-invite-preview', params.token],
    queryFn: () => api.orgInvites.preview(params.token!),
    enabled: !!params.token,
  });
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => api.orgInvites.accept(params.token!),
    onSuccess: () => {
      setAccepted(true);
      setTimeout(() => navigate(`/orgs/${preview.data!.orgSlug}`), 600);
    },
    onError: (e: Error) => setError(e.message),
  });

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
  if (preview.isLoading || me.isLoading) return <Centered>Loading…</Centered>;

  if (preview.isError) {
    return (
      <Centered>
        <Box>
          <p className="font-semibold text-red-400">This invite isn't valid.</p>
          <p className="mt-1 text-xs">{(preview.error as Error).message}</p>
        </Box>
      </Centered>
    );
  }

  const inv = preview.data!;
  const isSignedIn = !!me.data?.user;
  const wrongUser =
    isSignedIn && me.data!.user!.email.toLowerCase() !== inv.invitedEmail.toLowerCase();

  if (accepted) return <Centered>Joined! Opening the organization…</Centered>;

  return (
    <Centered>
      <Box>
        <h1 className="text-lg font-semibold">You're invited</h1>
        <p className="mt-2 text-sm text-neutral-400">
          You've been invited to join <strong>{inv.orgName}</strong> as a {inv.role}.
        </p>
        {!isSignedIn && (
          <Link
            to={`/login?next=${encodeURIComponent(`/org-invite/${params.token}`)}`}
            className="mt-3 block rounded bg-blue-600 px-4 py-2 text-center hover:bg-blue-500"
          >
            Sign in as {inv.invitedEmail}
          </Link>
        )}
        {wrongUser && (
          <p className="mt-3 rounded border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-200">
            The invite is for <strong>{inv.invitedEmail}</strong>, but you're signed in
            as <strong>{me.data!.user!.email}</strong>. Sign out and back in with the
            matching email.
          </p>
        )}
        {error && (
          <p className="mt-2 rounded border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">
            Couldn't accept: {error}
          </p>
        )}
      </Box>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center px-4">{children}</div>;
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-6">
      {children}
    </div>
  );
}
