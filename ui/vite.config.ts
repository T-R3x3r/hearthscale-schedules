import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';

/** The Hearthscale checkout the design system is linked from. */
const checkout = normalizePath(fileURLToPath(new URL('../../Hearthscale/', import.meta.url)));

// The realm loads exactly `ui.js` and `ui.css` from the app's folder, so
// the build lands both there as single files and touches nothing else.
// The design system is linked from the Hearthscale checkout, whose own
// React would otherwise be bundled a second time. Its index names every
// part of the design system; nothing from the checkout acts on being
// imported, so a module the page uses nothing of is left out.
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: '..',
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/index.tsx',
      treeshake: {
        moduleSideEffects: (id) => !normalizePath(id).startsWith(checkout),
      },
      // The entry's default export is what the realm calls.
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        inlineDynamicImports: true,
        entryFileNames: 'ui.js',
        assetFileNames: 'ui.css',
      },
    },
  },
});
