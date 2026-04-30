import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { AppHeader } from './AppHeader';
import { LayoutsPage } from './layouts/LayoutsPage';

export function App() {
  const { data, isLoading } = useQuery({ queryKey: ['me'], queryFn: api.me });
  if (isLoading) return <Loading />;
  if (!data?.user) return <Navigate to="/login" replace />;

  return (
    <div className="h-full overflow-y-auto p-8">
      <AppHeader user={data.user} />
      <main className="mt-8">
        <LayoutsPage />
      </main>
    </div>
  );
}

function Loading() {
  return <div className="grid h-full place-items-center text-neutral-500">Loading…</div>;
}
