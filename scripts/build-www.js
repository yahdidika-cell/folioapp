/**
 * Build Script: Menyiapkan aset web bersih ke folder www/ untuk Capacitor
 * Hanya menyalin file aplikasi produksi (mengabaikan file backup, setup, kredensial, dll.)
 */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT_DIR, 'www');

// Bersihkan atau buat folder www
if (fs.existsSync(WWW_DIR)) {
  fs.rmSync(WWW_DIR, { recursive: true, force: true });
}
fs.mkdirSync(WWW_DIR, { recursive: true });

// Daftar file & folder yang disalin
const ASSETS_TO_COPY = [
  'index.html',
  'style.css',
  'config.js',
  'supabase_adapter.js',
  'manifest.json',
  'service-worker.js',
  'sw.js',
  'Foliologo.jpg',
  'vendor'
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const items = fs.readdirSync(src);
    for (const item of items) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Menyalin aset web ke folder www/...');
for (const item of ASSETS_TO_COPY) {
  const srcPath = path.join(ROOT_DIR, item);
  const destPath = path.join(WWW_DIR, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`  ✓ ${item}`);
  } else {
    console.warn(`  ! File tidak ditemukan: ${item}`);
  }
}

console.log('✓ Selesai menyiapkan folder www/ untuk Capacitor.');
