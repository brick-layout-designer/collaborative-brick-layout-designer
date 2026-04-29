import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { LayoutsPage } from './layouts/LayoutsPage';

export function App() {
  const { data, isLoading } = useQuery({ queryKey: ['me'], queryFn: api.me });
  if (isLoading) return <Loading />;
  if (!data?.user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen p-8">
      <header className="flex items-center justify-between border-b border-neutral-800 pb-4">
        <h1 className="text-2xl font-semibold">CLD Web</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link to="/orgs" className="text-neutral-300 hover:underline">
            Organisations
          </Link>
          <Link to="/profile" className="flex items-center gap-2 hover:underline">
            {data.user.avatarUrl && (
              <img src={data.user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
            )}
            <span>{data.user.displayName}</span>
          </Link>
        </div>
      </header>
      <main className="mt-8">
        <LayoutsPage />
      </main>
    </div>
  );
}

function Loading() {
  return <div className="grid min-h-screen place-items-center text-neutral-500">Loading…</div>;
}
