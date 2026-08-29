import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { App } from './App';
import { LoginPage } from './auth/LoginPage';
import { ProfilePage } from './auth/ProfilePage';
import { LinkPage } from './auth/LinkPage';
import { InvitePage } from './auth/InvitePage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { EditorPage } from './editor/EditorPage';
import { OrgsPage } from './orgs/OrgsPage';
import { OrgDetailPage } from './orgs/OrgDetailPage';
import { OrgAdminPage } from './orgs/OrgAdminPage';
import { OrgInvitePage } from './orgs/OrgInvitePage';
import { TransferPage } from './layouts/TransferPage';
import { LibraryPage } from './library/LibraryPage';
import { AdminPage } from './admin/AdminPage';
import { AboutPage } from './AboutPage';
import { PublicLayoutPage } from './layouts/PublicLayoutPage';
import { api } from './api';
import Konva from 'konva';
import './styles.css';

// Only the LEFT mouse button starts a Konva drag. Default is `[0, 1, 2]`
// — i.e. middle and right clicks also drag, which clobbers our
// middle-click-pan and right-click-cancel behaviours (the editor's
// stage handlers can't fire when Konva eats the event for a drag).
// Mirrors the desktop, where pan is `Qt::MiddleButton` and drag is
// `Qt::LeftButton` only (MapView.cpp:392-541).
Konva.dragButtons = [0];

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
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/link" element={<LinkPage />} />
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
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
