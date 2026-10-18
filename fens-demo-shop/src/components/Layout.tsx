import { Outlet } from 'react-router-dom';
import { Footer } from './Footer';
import { Header } from './Header';
export function Layout() {
  return (
    <>
      <Header />
      <main className="page">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
