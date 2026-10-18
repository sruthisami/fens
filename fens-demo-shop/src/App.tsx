import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Guard } from './components/Guard';
import { Layout } from './components/Layout';
import { RouteMeta } from './components/RouteMeta';
import { CartPage } from './pages/Cart';
import { Category } from './pages/Category';
import { CheckoutAccount } from './pages/CheckoutAccount';
import { CheckoutAddress } from './pages/CheckoutAddress';
import { CheckoutBilling } from './pages/CheckoutBilling';
import { CheckoutConfirmation } from './pages/CheckoutConfirmation';
import { CheckoutDelivery } from './pages/CheckoutDelivery';
import { CheckoutReview } from './pages/CheckoutReview';
import { CheckoutShipping } from './pages/CheckoutShipping';
import { ForgotPassword } from './pages/ForgotPassword';
import { Help } from './pages/Help';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { NotFound } from './pages/NotFound';
import { Orders } from './pages/Orders';
import { ProductPage } from './pages/ProductPage';
import { ResetSent } from './pages/ResetSent';
import { Returns } from './pages/Returns';
import { Faq } from './pages/Faq';
import { SizeGuide } from './pages/SizeGuide';
import { Signup } from './pages/Signup';
import { LISTINGS, PRODUCTS } from './data/products';
import { ROUTES, type RouteEntry } from './routeTable';
import { isV2 } from './version';
const PAGES: Record<string, ReactElement> = {
  '/': <Home />,
  '/shoes': <Category title="Shoes" productIds={LISTINGS.shoes} />,
  '/bags': <Category title="Bags" productIds={LISTINGS.bags} />,
  '/accessories': <Category title="Accessories" productIds={LISTINGS.accessories} />,
  ...Object.fromEntries(
    PRODUCTS.map((p) => [`/product/${p.id}`, <ProductPage productId={p.id} />]),
  ),
  '/cart': <CartPage />,
  '/checkout/account': <CheckoutAccount />,
  '/checkout/shipping': <CheckoutShipping />,
  '/checkout/address': <CheckoutAddress />,
  '/checkout/delivery': <CheckoutDelivery />,
  '/checkout/billing': <CheckoutBilling />,
  '/checkout/review': <CheckoutReview />,
  '/checkout/confirmation': <CheckoutConfirmation />,
  '/login': <Login />,
  '/signup': <Signup />,
  '/forgot-password': <ForgotPassword />,
  '/reset-sent': <ResetSent />,
  '/orders': <Orders />,
  '/help': <Help />,
  '/returns': <Returns />,
  '/size-guide': <SizeGuide />,
  '/faq': <Faq />,
};
function elementFor(route: RouteEntry): ReactElement {
  if (isV2 && route.v2RedirectTo) return <Navigate to={route.v2RedirectTo} replace />;
  const page = PAGES[route.path] ?? <NotFound />;
  return <Guard guard={route.guard}>{page}</Guard>;
}
const isBare = (route: RouteEntry) => !isV2 && route.path === '/reset-sent';
export function App() {
  return (
    <>
      <RouteMeta />
      <Routes>
        {ROUTES.filter(isBare).map((r) => (
          <Route key={r.path} path={r.path} element={elementFor(r)} />
        ))}
        <Route element={<Layout />}>
          {ROUTES.filter((r) => !isBare(r)).map((r) => (
            <Route key={r.path} path={r.path} element={elementFor(r)} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
