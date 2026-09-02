import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';

const Home = lazy(() => import('./pages/Home'));
const TourView = lazy(() => import('./pages/TourView'));
const Login = lazy(() => import('./pages/Login'));
const TourEdit = lazy(() => import('./pages/TourEdit'));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-screen bg-background" aria-label="正在加载页面" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tour/:tourId" element={<TourView />} />
            <Route path="/tour/:tourId/edit" element={<TourEdit />} />
            <Route path="/create" element={<TourEdit />} />
            <Route path="/login" element={<Login />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
