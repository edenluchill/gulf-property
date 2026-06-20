import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Unique id per production build — injected into the bundle (__BUILD_ID__)
// and emitted as /version.json so running clients can detect new deploys.
var buildId = Date.now().toString(36);
function emitVersionJson() {
    return {
        name: 'emit-version-json',
        apply: 'build',
        generateBundle: function () {
            this.emitFile({
                type: 'asset',
                fileName: 'version.json',
                source: JSON.stringify({ buildId: buildId }),
            });
        },
    };
}
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), emitVersionJson()],
    define: {
        __BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
        alias: {
            '@': '/src',
        },
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
    optimizeDeps: {
        // Fix for maplibre-gl private class fields issue
        esbuildOptions: {
            target: 'es2022',
        },
    },
    build: {
        target: 'es2022',
    },
});
