import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Home from './pages/Home';
import TourView from './pages/TourView';
import Login from './pages/Login';
import TourEdit from './pages/TourEdit';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tour/:tourId" element={<TourView />} />
          <Route path="/tour/:tourId/edit" element={<TourEdit />} />
          <Route path="/create" element={<TourEdit />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
