import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({ base: '/Stopmo/', plugins: [vue(), VitePWA({ registerType: 'autoUpdate', includeAssets: ['icon.svg'], manifest: { name: 'Stopmo', short_name: 'Stopmo', description: 'An offline stop-motion studio', theme_color: '#111212', background_color: '#111212', display: 'standalone', start_url: '.', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }, workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'], navigateFallback: 'index.html' } })] })
