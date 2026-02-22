export default {
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
    base: './',
    build: {
      // target: 'es2019', //es2019
      minify: false,
      terserOptions: {
        compress: false,
        mangle: false,
      }
    }
};