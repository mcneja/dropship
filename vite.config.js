import { defineConfig } from 'vite';

function normalizeBase(base) {
    const raw = (base || './').trim();
    if (raw === '.' || raw === './') return './';

    let normalized = raw.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) normalized = `/${normalized}`;
    if (!normalized.endsWith('/')) normalized = `${normalized}/`;
    return normalized;
}

const configuredBase = normalizeBase(process.env.VITE_PUBLIC_BASE || './');

export default defineConfig({
    resolve: {
        preserveSymlinks: true
    },
    // optimizeDeps: {
    //     include: ['eskv']
    // },
    rollupOptions: {
        external: []
    },
    logLevel: 'info',
    plugins: [
      // logTransformedModules(),
      // visualizer({
      //   open: true,
      //   filename: 'bundle-analysis.html',
      //   gzipSize: true,
      //   brotliSize: true,
      // })
    ],
    base: configuredBase,
    build: {
      // target: 'es2019', //es2019
      minify: false,
      terserOptions: {
        compress: false,
        mangle: false,
      }
    }
});
