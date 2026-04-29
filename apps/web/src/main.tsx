import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { App } from './App';
import { LoginPage } from './auth/LoginPage';
import { ProfilePage } from './auth/ProfilePage';
import { LinkPage } from './auth/LinkPage';
import { InvitePage } from './auth/InvitePage';
import { EditorPage } from './editor/EditorPage';
import { OrgsPage } from './orgs/OrgsPage';
import { OrgDetailPage } from './orgs/OrgDetailPage';
import { OrgInvitePage } from './orgs/OrgInvitePage';
import { TransferPage } from './layouts/TransferPage';
import { LibraryPage } from './library/LibraryPage';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/link" element={<LinkPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/transfer/:token" element={<TransferPage />} />
          <Route path="/org-invite/:token" element={<OrgInvitePage />} />
          <Route path="/orgs" element={<OrgsPage />} />
          <Route path="/orgs/:slug" element={<OrgDetailPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/editor/:id" element={<EditorPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
