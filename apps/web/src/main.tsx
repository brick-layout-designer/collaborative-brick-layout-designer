import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { App } from './App';
import { LoginPage } from './auth/LoginPage';
import { ProfilePage } from './auth/ProfilePage';
import { LinkPage } from './auth/LinkPage';
import { InvitePage } from './auth/InvitePage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { DevicePage } from './auth/DevicePage';
import { OrgsPage } from './orgs/OrgsPage';
import { OrgDetailPage } from './orgs/OrgDetailPage';
import { OrgInvitePage } from './orgs/OrgInvitePage';
import { TransferPage } from './layouts/TransferPage';
import { AboutPage } from './AboutPage';
import { api } from './api';
import './styles.css';

// Heavy routes are code-split so the landing / auth pages don't download
// the editor (Konva, Yjs, parts rendering) or the admin console.
const EditorPage = lazy(() => import('./editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const AdminPage = lazy(() => import('./admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const LibraryPage = lazy(() => import('./library/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const OrgAdminPage = lazy(() => import('./orgs/OrgAdminPage').then((m) => ({ default: m.OrgAdminPage })));
const PublicLayoutPage = lazy(() => import('./layouts/PublicLayoutPage').then((m) => ({ default: m.PublicLayoutPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

/** Window-level .bbm file drop — opens any .bbm dropped onto any page. */
function GlobalBbmDrop() {
  const navigate = useNavigate();
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      const hasFile = Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === 'file');
      if (!hasFile) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
    async function onDrop(e: DragEvent) {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.endsWith('.bbm'));
      if (files.length === 0) return;
      e.preventDefault();
      for (const file of files) {
        try {
          const text = await file.text();
          const created = await api.layouts.create({ bbm: text });
          navigate(`/editor/${created.id}`);
        } catch {
          // silently ignore — editor page shows its own error
        }
      }
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [navigate]);
  return null;
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <GlobalBbmDrop />
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/link" element={<LinkPage />} />
          <Route path="/device" element={<DevicePage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          <Route path="/transfer/:token" element={<TransferPage />} />
          <Route path="/org-invite/:token" element={<OrgInvitePage />} />
          <Route path="/orgs" element={<OrgsPage />} />
          <Route path="/orgs/:slug" element={<OrgDetailPage />} />
          <Route path="/orgs/:slug/admin" element={<OrgAdminPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/editor/:id" element={<EditorPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/p/:token" element={<PublicLayoutPage />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
