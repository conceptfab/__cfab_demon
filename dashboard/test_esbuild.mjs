import * as esbuild from 'esbuild';

async function run() {
  try {
    await esbuild.build({
      entryPoints: ['src/main.tsx'],
      bundle: true,
      outfile: 'out.js',
      logLevel: 'error',
      external: [
        'react',
        'react-dom',
        'lucide-react',
        'recharts',
        'date-fns',
        'react-i18next',
        'zustand',
        '@tauri-apps/api/*',
      ],
    });
    console.log('ESBUILD_SUCCESS');
  } catch (e) {
    console.log('ESBUILD_FAILED:\n' + e.message);
  }
}
run();
