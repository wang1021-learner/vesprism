import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },

  css: {
    postcss: { plugins: [] }
  },
  build: {
    chunkSizeWarningLimit: 25000,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            {
              name: 'vendor-md',
              test: /node_modules[\\/](property-information|hast-util-[^\\/]+|mdast-util-[^\\/]+|micromark[^\\/]*|unist-util-[^\\/]+|vfile[^\\/]*|unified|stringify-entities|space-separated-tokens|comma-separated-tokens|zwitch|html-void-elements|devlop|style-to-js|style-to-object|clsx)[\\/]/
            },
            // 画布（@xyflow）用到的 d3 子包跟它同块，且必须排在 mermaid 前面：
            // 否则画布会拖进整块 mermaid/d3（其中 d3-format、vscode-jsonrpc 在加载时就会给只读的 toString 赋值，freezePrototype 下直接崩）。
            { name: 'xyflow', test: /node_modules[\\/](@xyflow|d3-(zoom|drag|selection|transition|interpolate|color|ease|timer|dispatch))[\\/]/ },
            {
              name: 'mermaid',
              test: /node_modules[\\/](mermaid|cytoscape|dagre|khroma|elkjs|d3|d3-[^\\/]+|@mermaid-js)[\\/]/
            },
            { name: 'shiki', test: /node_modules[\\/](shiki|@shikijs|react-shiki|@streamdown[\\/]code|oniguruma-to-es|oniguruma-parser|regex(-[^\\/]+)?)[\\/]/ },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/ }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // 优先 TSX/TS，避免 src 里残留的 tsc 产物 .js 盖住最新源码
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.jsx', '.js', '.json'],
    dedupe: ['react', 'react-dom'],
  },
  // 必须与 src-tauri/tauri.conf.json → build.devUrl 一致
  server: {
    host: '127.0.0.1',
    port: 9527,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 9527,
  },
})
