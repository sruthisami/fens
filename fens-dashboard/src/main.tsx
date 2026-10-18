import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { identity } from './identity';
import './index.css';
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element in index.html');
}
function Root() {
  const key = () => `${identity().tenant}|${identity().user}`;
  const [id, setId] = useState(key);
  return <App key={id} onIdentityChange={() => setId(key())} />;
}
createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
