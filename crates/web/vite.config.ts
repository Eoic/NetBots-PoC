import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
    build: {
        outDir: 'static/dist',
        emptyOutDir: true,
        sourcemap: mode === 'development',
        minify: mode !== 'development',
        cssCodeSplit: false,
        rollupOptions: {
            input: resolve(__dirname, 'assets/ts/main.ts'),
            external: ['pixi.js'],
            output: {
                format: 'es',
                entryFileNames: 'main.js',
                assetFileNames: (assetInfo) =>
                    assetInfo.name?.endsWith('.css') ? 'style.css' : 'assets/[name]-[hash][extname]',
            },
        },
    },
}));
