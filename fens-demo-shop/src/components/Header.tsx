import { Link } from 'react-router-dom';
import { useCart } from '../cart';
import { isV2 } from '../version';
import { SignInButton } from './SignInButton';
export function Header() {
  const { count } = useCart();
  return (
    <header className="site-header" data-component="Header">
      <p className="announcement">Free shipping over $75. Returns within 30 days.</p>
      <div className="header-bar">
        <Link to="/" className="logo">
          Fence
        </Link>
        <nav aria-label="Main">
          <Link to="/shoes">Shoes</Link>
          <Link to="/bags">Bags</Link>
          <Link to="/accessories">Accessories</Link>
          <Link to="/help">Help</Link>
          {isV2 && <Link to="/orders">Orders</Link>}
        </nav>
        <div className="header-actions">
          <Link to="/cart">Cart ({count})</Link>
          <SignInButton />
        </div>
      </div>
    </header>
  );
}
