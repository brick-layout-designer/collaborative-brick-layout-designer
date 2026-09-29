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
import { OrgsPage } from './orgs/OrgsPage';
import { OrgDetailPage } from './orgs/OrgDetailPage';
import { OrgInvitePage } from './orgs/OrgInvitePage';
import { TransferPage } from './layouts/TransferPage';
import { AboutPage } from './AboutPage';
import { api } from './api';
import { layoutsFromFiles, type DroppedLayout } from './bbmFiles';
import { catalogMapConverter, MAP_FORMAT_FILE, type OpenedMapState } from './mapFormats';
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

/**
 * Window-level layout drop — opens any .bbm dropped onto any page, with the
 * `.bbm.bld` sidecar dropped alongside it (or both inside a .zip, as the
 * editor's Download .bbm writes them), like desktop's open
 * (MainWindowFileIO.cpp:84-94). LDraw, TrackDesigner and 4DBrix maps are
 * converted first; what the conversion skipped shows in the editor's
 * status bar, as on desktop.
 */
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
      const files = Array.from(e.dataTransfer?.files ?? []).filter(
        (f) => /\.(bbm|bbm\.bld|bbm\.cld|zip)$/i.test(f.name) || MAP_FORMAT_FILE.test(f.name),
      );
      if (!files.some((f) => /\.(bbm|zip)$/i.test(f.name) || MAP_FORMAT_FILE.test(f.name))) return;
      e.preventDefault();
      let layouts: DroppedLayout[] = [];
      try {
        const convert = catalogMapConverter(
          async () => (await queryClient.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 })).parts,
        );
        layouts = await layoutsFromFiles(files, convert);
      } catch (err) {
        // An unreadable zip has nothing to open; say why a map file didn't.
        if (files.some((f) => MAP_FORMAT_FILE.test(f.name))) window.alert(`Open failed: ${(err as Error).message}`);
        return;
      }
      for (const l of layouts) {
        try {
          const created = await api.layouts.create(l.sidecar !== undefined ? { bbm: l.bbm, sidecar: l.sidecar } : { bbm: l.bbm });
          const state: OpenedMapState | undefined = l.warnings ? { openWarnings: l.warnings } : undefined;
          navigate(`/editor/${created.id}`, state ? { state } : undefined);
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
