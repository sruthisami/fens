import { defineConfig } from 'vite';
export default defineConfig(({ isSsrBuild }) => ({
  envPrefix: ['VITE_', 'SHOP_'],
  build: { copyPublicDir: !isSsrBuild },
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
}));
