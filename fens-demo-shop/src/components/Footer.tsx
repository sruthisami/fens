import { Link } from 'react-router-dom';
export function Footer() {
  return (
    <footer className="site-footer" data-component="Footer">
      <span className="footer-logo">Fence</span>
      <p className="tagline">Made to be worn, not kept in the box.</p>
      <div className="footer-links">
        <Link to="/help">Help</Link>
        <Link to="/returns">Returns</Link>
        <Link to="/size-guide">Size guide</Link>
        <Link to="/faq">FAQ</Link>
      </div>
      <small>© 2026 Fence</small>
    </footer>
  );
}
