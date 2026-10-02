// A person's or club's warnings on their admin page: the history (site
// warnings, and for site admins the clubs' own warnings too), whether each
// was read, and the form to send another. The next steps, read-only and
// limits, are right below it (SubjectLimitsPanel).

import { useQuery } from '@tanstack/react-query';
import { api, type WarningSubject } from '../api';
import { WarnForm, WarningHistory } from '../notices/Notices';

export function SubjectWarnings({ subject, name }: { subject: WarningSubject; name: string }) {
  const history = useQuery({ queryKey: ['warnings', subject.kind, subject.id], queryFn: () => api.warnings.history(subject) });
  return (
    <div className="space-y-3">
      {history.isLoading ? <p className="text-sm text-muted">Loading…</p> : <WarningHistory warnings={history.data?.warnings ?? []} />}
      <WarnForm label={`Warn ${name}`} onSend={(input) => api.warnings.send(subject, input)} />
      <p className="text-xs text-muted">
        {subject.kind === 'org'
          ? "The club's admins and managers see it and must say they've read it."
          : "They see it on every page until they say they've read it."}{' '}
        To go further, make them read-only or set limits below.
      </p>
    </div>
  );
}
