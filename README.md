# Folio - Aplikasi Manajemen Keuangan, Cicilan Barang & Crypto Exchange (Google Apps Script)

Aplikasi pencatatan keuangan pribadi profesional berbasis **Google Apps Script** dan **Google Sheets**, dilengkapi dengan modul **Cicilan Barang (Kredit / PayLater Belum Lunas)**, **Utang Piutang**, **Pemasukan & Pengeluaran**, **Crypto Exchange Income (USD to IDR)**, **Statistik Arus Kas**, dan **Riwayat Transaksi**.

Desain antarmuka dibuat presisi, modern, dan responsif mengikuti referensi:
- **Tampilan Desktop**: Dilengkapi sidebar navigasi, kartu hero saldo biru, kartu ringkasan utang piutang, kartu cicilan barang belum lunas, grafik batang arus kas 6 bulan terakhir, diagram donat pengeluaran per kategori, tabel riwayat, dan form cepat tambah transaksi.
- **Tampilan Mobile**: Dilengkapi sapaan profil dinamis, grid menu akses cepat (termasuk Cicilan), kartu ringkasan, dan *bottom navigation bar* dengan tombol floating action button (+).

---

## 📁 Struktur File Proyek

| File | Deskripsi |
| :--- | :--- |
| `code.gs` | Backend Google Apps Script (routing `doGet`, API transaksi, API utang piutang, API cicilan barang, API crypto, integrasi live exchange rate, dan kalkulasi statistik). |
| `setup.gs` | Script inisialisasi database sheet otomatis (membuat sheet `Transaksi`, `UtangPiutang`, `Cicilan`, `CryptoIncome`, `Pengaturan`, `Users`, dan `Kategori` beserta format dan data contoh). |
| `index.html` | Frontend SPA (*Single Page Application*) modern dengan Tailwind CSS, Chart.js, Lucide Icons, modal interaktif, validasi saldo dompet, dan kalkulator konversi kurs real-time. |

---

## ✨ Fitur & Pembaruan Terbaru

### 1. Desain Background Login Modern & Estetik
- **Latar Belakang Baru**: Layar masuk (*Login Screen*) menggunakan tema modern kelas dunia:
  - *Dynamic layered gradient mesh* (`#070e1c` midnight sapphire) dengan efek *pulsing ambient light*.
  - *Tech dot-matrix mesh overlay* berpresisi tinggi.
  - *Floating decorative badges* (pemasukan terverifikasi dan crypto & multi-wallet indicator).
  - Kartu login *glassmorphism* dengan bayangan lembut dan sudut melengkung modern (*rounded-3xl*).

### 2. Opsi Rekening Saja & Normalisasi Dompet
- Rekening spesifik (Rekening BCA, Rekening Mandiri, BCA Mobile, dll.) telah diganti menjadi opsi umum:
  - **`Rekening Bank`**
  - **`Tunai / Cash`**
  - **`E-Wallet`**
  - **`Lainnya`**
- Sistem backend dan frontend otomatis menormalisasi transaksi lama ke kategori dompet baru tersebut secara rapi.

### 3. Tampilan Saldo Dompet & Pencegahan Pengeluaran Saat Saldo Rp 0
- **Tampilan Saldo Interaktif**: Saat memilih Dompet / Rekening pada form Tambah Transaksi, saldo dompet yang tersedia langsung ditampilkan secara *real-time*.
- **Pencegahan Pengeluaran (Kunci Saldo 0)**:
  - Jika saldo dompet adalah **Rp 0** atau lebih kecil dari nominal yang dimasukkan pada transaksi **Pengeluaran**, tombol simpan otomatis terkunci (*disabled*) dan muncul pesan peringatan.
  - Pada transaksi **Pemasukan**, transaksi tetap dapat dilakukan secara normal meskipun saldo saat ini Rp 0.
  - Validasi diterapkan ganda di sisi frontend dan backend (`code.gs`).

### 4. Menu Anggaran Dihapus & Digantikan Modul "Cicilan Barang"
- **Menu Anggaran Sepenuhnya Dihapus**: Kartu anggaran di dasbor, menu cepat anggaran di mobile, serta input batas anggaran bulanan di menu Pengaturan telah ditiadakan.
- **Modul Cicilan Barang Baru (Kredit / PayLater Belum Lunas)**:
  - **Kartu Dasbor Cicilan Belum Lunas**: Menampilkan total sisa tagihan cicilan, tagihan bulan ini, jumlah barang aktif belum lunas, dan progress bar pelunasan.
  - **Navigasi Cicilan**: Tersedia di Sidebar Desktop dan Menu Cepat Mobile.
  - **Halaman Cicilan (`#view-installments`)**:
    - 4 Kartu Metrik: Total Nilai Barang, Sisa Tagihan Belum Lunas, Total Telah Dibayar, dan Estimasi Tagihan Bulan Ini.
    - Filter tab: Semua, Belum Lunas, dan Sudah Lunas.
    - Kartu detail barang lengkap dengan platform (Shopee PayLater, Kredivo, dll.), tenor, angsuran per bulan, sisa bulan, dan tanggal jatuh tempo bulanan.
  - **Modal Tambah Cicilan**: Input nama barang, platform, total harga, DP / bayar awal, tenor bulan, angsuran per bulan, tanggal jatuh tempo, dan tanggal mulai.
  - **Modal Bayar Angsuran Cicilan**: Opsi bayar 1x angsuran bulanan atau pelunasan penuh, pilihan dompet pemotong saldo (dengan validasi saldo cukup), dan pencatatan otomatis ke transaksi kas pengeluaran.
  - **Sheet Spreadsheet**: Data cicilan tersimpan rapi pada sheet `Cicilan` di Google Sheets.

### 5. Pemasukan & Pengeluaran Kas
- **Default Pemasukan:** Saat mengeklik tombol **Tambah transaksi** maupun ikon floating **(+)**, sistem otomatis memilih tipe **Pemasukan** sebagai default.
- **Tata Letak Tab:** Tab **Pemasukan di KIRI** dan **Pengeluaran di KANAN**.
- **Warna Selaras:** Indikator pemasukan (emerald) dan pengeluaran (rose) selaras dengan kartu biru dan tema aplikasi.

### 6. Pemasukan Crypto Exchange
- Sakelar On/Off terintegrasi langsung di menu Crypto Exchange (terkunci saat OFF, aktif saat ON).
- Pengaturan kurs default USD-IDR dan pengecekan live kurs real-time langsung di halaman Crypto Exchange.

### 7. Pengelolaan Logo Web Terpusat (Admin)
- Admin dapat mengunggah 1 logo yang otomatis menggantikan seluruh logo di seluruh aplikasi (sidebar, mobile header, login).
- Menu logo tersembunyi untuk pengguna biasa.

---

## 🚀 Panduan Pemasangan di Google Sheets & Google Apps Script

Ikuti langkah mudah berikut untuk memasang aplikasi:

### Langkah 1: Buat Spreadsheet Baru
1. Buka [Google Sheets](https://sheets.new) di browser Anda.
2. Beri nama spreadsheet Anda, misalnya **"Database Folio"**.

### Langkah 2: Buka Apps Script Editor
1. Pada menu atas Google Sheets, klik **Extensions (Ekstensi)** > **Apps Script**.
2. Anda akan diarahkan ke editor Google Apps Script.

### Langkah 3: Masukkan Kode File
1. Ubah nama file default `Code.gs` menjadi `code.gs`, lalu salin seluruh isi file **`code.gs`** ke dalamnya.
2. Buat file script baru: klik tanda `+` di samping *Files* > pilih **Script**, beri nama **`setup.gs`**, lalu salin seluruh isi file **`setup.gs`** ke dalamnya.
3. Buat file HTML: klik tanda `+` di samping *Files* > pilih **HTML**, beri nama **`index`** (Apps Script akan menambahkan ekstensi `.html` otomatis), lalu salin seluruh isi file **`index.html`** ke dalamnya.

### Langkah 4: Inisialisasi Database
1. Pada bagian atas editor Apps Script, pilih fungsi **`setupDatabase`** dari menu dropdown fungsi.
2. Klik tombol **Run (Jalankan)**.
3. Jika muncul permintaan izin (*Authorization Required*):
   - Klik **Review permissions**.
   - Pilih akun Google Anda.
   - Klik **Advanced (Lanjutan)** > klik **Go to [Nama Proyek] (unsafe/tidak aman)**.
   - Klik **Allow (Izinkan)**.
4. Periksa Google Spreadsheet Anda: Sheet `Transaksi`, `UtangPiutang`, `Cicilan`, `CryptoIncome`, `Pengaturan`, `Users`, dan `Kategori` akan otomatis terbuat beserta data sampelnya.

### Langkah 5: Deploy Sebagai Web App
1. Klik tombol **Deploy (Terapkan)** berwarna biru di pojok kanan atas > pilih **New deployment (Penerapan baru)**.
2. Klik ikon gerigi (Select type) > pilih **Web app**.
3. Isi konfigurasi berikut:
   - **Description:** `Folio Web App v2.2`
   - **Execute as (Jalankan sebagai):** `Me (emailanda@gmail.com)`
   - **Who has access (Siapa yang memiliki akses):** `Anyone (Siapa saja)` atau `Only myself (Hanya saya)`.
4. Klik **Deploy**.
5. Salin URL Web App yang dihasilkan. Anda dapat membuka URL tersebut di browser desktop maupun smartphone.
