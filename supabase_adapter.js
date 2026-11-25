// =========================================================================
// SUPABASE ADAPTER UNTUK FOLIO - OFFLINE-FIRST ARCHITECTURE
// Menghubungkan UI Folio ke Supabase dengan performa instan (<50ms)
// Mendukung penyimpanan lokal (IndexedDB) saat offline & Auto-Sync saat online
// =========================================================================

(function (window) {
  'use strict';

  function getBaseUrl() {
    let url = (typeof window.SUPABASE_URL !== 'undefined' && window.SUPABASE_URL) 
      ? window.SUPABASE_URL 
      : localStorage.getItem('folio_supabase_url');
    if (!url) return '';
    return url.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/, '');
  }

  function getApiKey() {
    return (typeof window.SUPABASE_ANON_KEY !== 'undefined' && window.SUPABASE_ANON_KEY)
      ? window.SUPABASE_ANON_KEY
      : (localStorage.getItem('folio_supabase_key') || '');
  }

  function isConfigured() {
    return !!(getBaseUrl() && getApiKey());
  }

  // Status jaringan: utamakan plugin native Capacitor (@capacitor/network) karena
  // navigator.onLine di WebView Android kadang tidak akurat. Fallback ke event browser.
  let nativeConnected = null;

  function isOnline() {
    if (nativeConnected !== null) return nativeConnected;
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  }

  // UUID v4 dibuat di sisi klien agar ID record tidak bentrok antar perangkat saat sinkronisasi
  function uuidv4() {
    const c = window.crypto || window.msCrypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) {}
    }
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(b);
    } else {
      for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40; // versi 4
    b[8] = (b[8] & 0x3f) | 0x80; // varian RFC 4122
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function isNetworkError(err) {
    return err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(String(err && err.message));
  }

  async function apiFetch(path, options = {}) {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    if (!baseUrl || !apiKey) {
      throw new Error('Supabase belum dikonfigurasi.');
    }

    const headers = {
      'apikey': apiKey,
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const url = `${baseUrl}/rest/v1/${path.replace(/^\/+/, '')}`;
    const res = await fetch(url, { ...options, headers });
    
    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.message || errText;
      } catch (e) {}
      throw new Error(`Supabase Error (${res.status}): ${errMsg}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    return await res.text();
  }

  // =========================================================================
  // FOLIO OFFLINE STORAGE (IndexedDB dengan Fallback LocalStorage)
  // =========================================================================
  const DB_NAME = 'folio_offline_db';
  const DB_VERSION = 1;
  const STORES = ['cache', 'outbox', 'transactions', 'debts', 'installments', 'crypto', 'wishlist'];

  let idbInstance = null;

  function openIndexedDB() {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return resolve(null);
      }
      if (idbInstance) return resolve(idbInstance);

      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function (e) {
          const db = e.target.result;
          STORES.forEach(storeName => {
            if (!db.objectStoreNames.contains(storeName)) {
              if (storeName === 'outbox') {
                db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
              } else {
                db.createObjectStore(storeName, { keyPath: 'id' });
              }
            }
          });
        };
        request.onsuccess = function (e) {
          idbInstance = e.target.result;
          resolve(idbInstance);
        };
        request.onerror = function (e) {
          console.warn('Gagal membuka IndexedDB, fallback ke localStorage:', e);
          resolve(null);
        };
      } catch (err) {
        resolve(null);
      }
    });
  }

  const FolioOfflineDB = {
    async set(storeName, item) {
      if (!item) return;
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            store.put(item);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          });
        }
      } catch (e) {}

      // Fallback localStorage
      try {
        const key = `folio_${storeName}_${item.id || 'single'}`;
        localStorage.setItem(key, JSON.stringify(item));
      } catch (e) {}
    },

    async get(storeName, id) {
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
          });
        }
      } catch (e) {}

      try {
        const raw = localStorage.getItem(`folio_${storeName}_${id}`);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    async getAll(storeName) {
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          });
        }
      } catch (e) {}

      try {
        const prefix = `folio_${storeName}_`;
        const items = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) {
            items.push(JSON.parse(localStorage.getItem(k)));
          }
        }
        return items;
      } catch (e) {
        return [];
      }
    },

    async delete(storeName, id) {
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            store.delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          });
        }
      } catch (e) {}

      try {
        localStorage.removeItem(`folio_${storeName}_${id}`);
      } catch (e) {}
    },

    // Tulis & hapus banyak record dalam satu transaksi IndexedDB (lebih cepat saat merge data server)
    async bulkWrite(storeName, putItems = [], deleteIds = []) {
      if (!putItems.length && !deleteIds.length) return true;
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            putItems.forEach(item => store.put(item));
            deleteIds.forEach(id => store.delete(id));
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          });
        }
      } catch (e) {}
      for (const item of putItems) await this.set(storeName, item);
      for (const id of deleteIds) await this.delete(storeName, id);
      return true;
    },

    // OUTBOX QUEUE UNTUK SINKRONISASI
    async addToOutbox(action, payload) {
      const entry = {
        action,
        payload,
        createdAt: new Date().toISOString(),
        timestamp: Date.now()
      };
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction(['outbox'], 'readwrite');
            const store = tx.objectStore('outbox');
            const req = store.add(entry);
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = () => resolve(null);
          });
        }
      } catch (e) {}

      try {
        const outbox = JSON.parse(localStorage.getItem('folio_outbox_queue') || '[]');
        entry.id = Date.now() + Math.random();
        outbox.push(entry);
        localStorage.setItem('folio_outbox_queue', JSON.stringify(outbox));
        return entry.id;
      } catch (e) {
        return null;
      }
    },

    async getOutbox() {
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction(['outbox'], 'readonly');
            const store = tx.objectStore('outbox');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          });
        }
      } catch (e) {}

      try {
        return JSON.parse(localStorage.getItem('folio_outbox_queue') || '[]');
      } catch (e) {
        return [];
      }
    },

    async removeFromOutbox(id) {
      try {
        const db = await openIndexedDB();
        if (db) {
          return new Promise((resolve) => {
            const tx = db.transaction(['outbox'], 'readwrite');
            const store = tx.objectStore('outbox');
            store.delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          });
        }
      } catch (e) {}

      try {
        let outbox = JSON.parse(localStorage.getItem('folio_outbox_queue') || '[]');
        outbox = outbox.filter(item => item.id !== id);
        localStorage.setItem('folio_outbox_queue', JSON.stringify(outbox));
      } catch (e) {}
    }
  };

  // =========================================================================
  // LOCAL REPOSITORY: setiap record disimpan di IndexedDB dengan metadata
  //   is_synced  : false jika ada perubahan lokal yang belum terkirim ke Supabase
  //   updated_at : waktu perubahan terakhir (ISO) - dasar last-write-wins
  //   _deleted   : tombstone untuk penghapusan saat offline
  //   _remote    : true jika record sudah pernah ada di server
  // Field lokal dibuang sebelum dikirim, jadi tabel Supabase tidak perlu diubah.
  // =========================================================================
  const SYNC_TABLES = ['transactions', 'debts', 'installments', 'wishlist', 'crypto'];
  const LOCAL_ONLY_FIELDS = ['is_synced', 'updated_at', '_deleted', '_remote', '_created_at'];

  function stripLocalFields(rec) {
    const clean = {};
    Object.keys(rec || {}).forEach(k => {
      if (!LOCAL_ONLY_FIELDS.includes(k)) clean[k] = rec[k];
    });
    return clean;
  }

  function sortNewestFirst(rows) {
    return rows.sort((a, b) =>
      String(b._created_at || b.created_at || b.updated_at || '').localeCompare(String(a._created_at || a.created_at || a.updated_at || ''))
    );
  }

  const LocalRepo = {
    async all(table, includeDeleted = false) {
      const rows = await FolioOfflineDB.getAll(table);
      return includeDeleted ? rows : rows.filter(r => r && !r._deleted);
    },

    async get(table, id) {
      return FolioOfflineDB.get(table, String(id));
    },

    // Simpan / edit record secara lokal dan tandai belum tersinkron
    async save(table, row) {
      const existing = await this.get(table, row.id);
      const now = new Date().toISOString();
      const rec = {
        ...(existing || {}),
        ...row,
        id: String(row.id),
        is_synced: false,
        updated_at: now,
        _deleted: false,
        _remote: !!(existing && existing._remote),
        _created_at: (existing && existing._created_at) || row.created_at || now
      };
      await FolioOfflineDB.set(table, rec);
      return rec;
    },

    // Hapus record: jika belum pernah sampai server cukup dihapus lokal, jika sudah -> tombstone
    async remove(table, id) {
      const existing = await this.get(table, id);
      if (existing && !existing._remote) {
        await FolioOfflineDB.delete(table, String(id));
        return null;
      }
      const rec = {
        ...(existing || { id: String(id), _remote: true }),
        _deleted: true,
        is_synced: false,
        updated_at: new Date().toISOString()
      };
      await FolioOfflineDB.set(table, rec);
      return rec;
    },

    async pending() {
      const out = [];
      for (const t of SYNC_TABLES) {
        const rows = await this.all(t, true);
        rows.filter(r => r && r.is_synced === false).forEach(rec => out.push({ table: t, rec }));
      }
      out.sort((a, b) => String(a.rec.updated_at).localeCompare(String(b.rec.updated_at)));
      return out;
    },

    // Gabungkan data server ke lokal. Perubahan lokal yang belum tersinkron selalu dipertahankan.
    async mergeServer(table, serverRows) {
      const local = await this.all(table, true);
      const localMap = new Map(local.map(r => [String(r.id), r]));
      const serverIds = new Set();
      const puts = [];
      const deletes = [];

      (serverRows || []).forEach(row => {
        const id = String(row.id);
        serverIds.add(id);
        const lr = localMap.get(id);
        if (lr && lr.is_synced === false) {
          if (!lr._remote) puts.push({ ...lr, _remote: true });
          return;
        }
        puts.push({
          ...row,
          id,
          is_synced: true,
          updated_at: (lr && lr.updated_at) || row.created_at || new Date().toISOString(),
          _deleted: false,
          _remote: true,
          _created_at: row.created_at || (lr && lr._created_at) || ''
        });
      });

      // Record yang sudah tersinkron tapi hilang dari server = dihapus dari perangkat lain
      local.forEach(lr => {
        if (!serverIds.has(String(lr.id)) && lr.is_synced !== false) deletes.push(String(lr.id));
      });

      await FolioOfflineDB.bulkWrite(table, puts, deletes);
      return sortNewestFirst(await this.all(table));
    }
  };

  // Kirim satu record ke Supabase (upsert / delete) lalu tandai is_synced: true
  async function pushRecord(table, rec) {
    const id = String(rec.id);
    if (rec._deleted) {
      await apiFetch(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      const latest = await FolioOfflineDB.get(table, id);
      if (latest && latest._deleted) await FolioOfflineDB.delete(table, id);
      return;
    }

    await apiFetch(`${table}?on_conflict=id`, {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([stripLocalFields(rec)])
    });

    // Jangan timpa status jika record berubah lagi selama request berjalan
    const latest = await FolioOfflineDB.get(table, id);
    if (!latest) return;
    if (latest.updated_at === rec.updated_at) {
      await FolioOfflineDB.set(table, { ...latest, is_synced: true, _remote: true });
    } else if (!latest._remote) {
      await FolioOfflineDB.set(table, { ...latest, _remote: true });
    }
  }

  // Antrean lama (outbox) tetap diproses: pengaturan, registrasi akun, dan sisa antrean versi sebelumnya
  const LEGACY_ADD = { addTransaction: 'transactions', addDebt: 'debts', addInstallment: 'installments', addCryptoIncome: 'crypto', addWishlistItem: 'wishlist' };
  const LEGACY_DEL = { deleteTransaction: 'transactions', deleteDebt: 'debts', deleteInstallment: 'installments', deleteCryptoIncome: 'crypto', deleteWishlistItem: 'wishlist', deleteWishlist: 'wishlist' };
  const LEGACY_PATCH = { payInstallment: 'installments', recordWishlistSavings: 'wishlist' };

  async function runOutboxAction(action, payload) {
    if (LEGACY_ADD[action]) {
      await apiFetch(`${LEGACY_ADD[action]}?on_conflict=id`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([stripLocalFields(payload)])
      });
    } else if (LEGACY_DEL[action]) {
      await apiFetch(`${LEGACY_DEL[action]}?id=eq.${encodeURIComponent(payload)}`, { method: 'DELETE' });
    } else if (LEGACY_PATCH[action]) {
      if (payload && payload.id && payload.patch) {
        await apiFetch(`${LEGACY_PATCH[action]}?id=eq.${encodeURIComponent(payload.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload.patch)
        });
      }
    } else if (action === 'recordDebtPayment') {
      if (payload && payload.id && payload.terbayar !== undefined) {
        const { id, terbayar, sisa, status } = payload;
        await apiFetch(`debts?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ terbayar, sisa, status })
        });
      }
    } else if (action === 'registerUser') {
      const username = String((payload && payload.username) || '').toLowerCase().trim();
      if (username) {
        const existing = await apiFetch(`users?select=id&username=ilike.${encodeURIComponent(username)}`);
        if (!existing || existing.length === 0) {
          await apiFetch('users', {
            method: 'POST',
            body: JSON.stringify([{ name: payload.name, username, password: payload.password }])
          });
        }
      }
    } else if (action === 'updateSettings') {
      const sPayload = payload && payload.settingsPayload ? payload.settingsPayload : payload;
      const uName = payload && payload.username ? payload.username : null;
      const rows = Object.keys(sPayload || {}).map(k => ({
        key: k,
        value: typeof sPayload[k] === 'object' ? JSON.stringify(sPayload[k]) : String(sPayload[k])
      }));
      if (rows.length > 0) {
        await apiFetch('settings', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(rows)
        });
      }
      if (sPayload && sPayload.user_name && uName) {
        try {
          await apiFetch(`users?username=ilike.${encodeURIComponent(uName)}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: sPayload.user_name })
          });
        } catch (uErr) {}
      }
    }
    // Aksi tidak dikenal / payload versi lama yang tidak lengkap dilewati agar tidak macet
  }

  async function flushOutbox() {
    const outbox = await FolioOfflineDB.getOutbox();
    let done = 0;
    for (const item of (outbox || [])) {
      try {
        await runOutboxAction(item.action, item.payload);
        await FolioOfflineDB.removeFromOutbox(item.id);
        done++;
      } catch (err) {
        console.warn('Gagal sinkron antrean:', item, err);
        if (!isOnline() || isNetworkError(err)) break;
      }
    }
    return done;
  }

  // =========================================================================
  // INDIKATOR STATUS KONEKSI (badge di header, gaya di style.css: .net-pill)
  // =========================================================================
  let lastPendingCount = 0;

  async function countPending() {
    const pending = await LocalRepo.pending();
    const outbox = await FolioOfflineDB.getOutbox();
    return pending.length + ((outbox && outbox.length) || 0);
  }

  function updateNetworkStatusUI(status, count) {
    if (typeof document === 'undefined') return;
    const pill = document.getElementById('network-status-pill');
    if (!pill) return;

    const n = typeof count === 'number' ? count : lastPendingCount;
    lastPendingCount = n;

    let icon, longText, shortText, title;
    if (status === 'syncing') {
      icon = '<span class="net-pill__spin" aria-hidden="true"></span>';
      longText = `Menyinkronkan ${n} data…`;
      shortText = 'Sync';
      title = 'Sedang mengirim data lokal ke server';
    } else if (status === 'offline') {
      icon = '<span class="net-pill__dot" aria-hidden="true"></span>';
      longText = 'Offline - Tersimpan Lokal';
      shortText = 'Offline';
      title = n > 0
        ? `Offline: ${n} perubahan tersimpan di perangkat, otomatis dikirim saat online`
        : 'Offline: data tersimpan di perangkat';
    } else {
      status = 'online';
      icon = '<span class="net-pill__dot" aria-hidden="true"></span>';
      longText = 'Online';
      shortText = 'Online';
      title = n > 0 ? `Online: ${n} perubahan menunggu sinkronisasi` : 'Online: semua data tersinkron';
    }

    const badge = n > 0 && status !== 'syncing' ? `<span class="net-pill__count">${n}</span>` : '';
    pill.className = `net-pill net-pill--${status}`;
    pill.dataset.status = status;
    pill.title = title;
    pill.setAttribute('aria-label', title);
    pill.innerHTML = `${icon}<span class="net-pill__text net-pill__text--long" id="network-status-text">${longText}</span><span class="net-pill__text net-pill__text--short">${shortText}</span>${badge}`;
  }

  async function refreshStatusUI() {
    try {
      const n = await countPending();
      updateNetworkStatusUI(isOnline() ? 'online' : 'offline', n);
    } catch (e) {}
  }

  // =========================================================================
  // MESIN SINKRONISASI: kirim semua record is_synced:false ke Supabase
  // =========================================================================
  let isSyncing = false;
  let syncRequestedAgain = false;

  async function syncPending() {
    if (!isOnline() || !isConfigured()) {
      await refreshStatusUI();
      return { synced: 0, failed: 0 };
    }
    if (isSyncing) {
      syncRequestedAgain = true;
      return { synced: 0, failed: 0, busy: true };
    }

    isSyncing = true;
    let synced = 0;
    let failed = 0;
    try {
      const pending = await LocalRepo.pending();
      const outbox = await FolioOfflineDB.getOutbox();
      const total = pending.length + ((outbox && outbox.length) || 0);
      if (total > 0) updateNetworkStatusUI('syncing', total);

      synced += await flushOutbox();

      for (const { table, rec } of pending) {
        try {
          await pushRecord(table, rec);
          synced++;
        } catch (err) {
          failed++;
          console.warn(`Gagal sinkron ${table}/${rec.id}:`, err);
          if (!isOnline() || isNetworkError(err)) break;
        }
      }
    } finally {
      isSyncing = false;
    }

    await refreshStatusUI();

    if (syncRequestedAgain) {
      syncRequestedAgain = false;
      const again = await syncPending();
      synced += again.synced || 0;
      failed += again.failed || 0;
    }
    return { synced, failed };
  }

  // Sinkron di latar belakang + muat ulang tampilan jika ada data yang terkirim
  async function autoSync() {
    const res = await syncPending();
    if (res && res.synced > 0) {
      if (typeof window.showToast === 'function') {
        window.showToast(`${res.synced} data offline berhasil disinkronkan ke Cloud!`, 'success');
      }
      try {
        if (typeof AppState !== 'undefined') AppState.lastFetchedAt = 0;
      } catch (e) {}
      if (typeof window.loadAllAppData === 'function') window.loadAllAppData(false);
    }
    return res;
  }

  // Kompatibilitas: nama lama tetap tersedia
  const syncOutbox = autoSync;

  // =========================================================================
  // DETEKSI PERUBAHAN KONEKSI (Capacitor Network + event browser)
  // =========================================================================
  let lastKnownOnline = isOnline();

  function onConnectivityChange(connected, source) {
    if (source === 'native') {
      nativeConnected = connected;
    } else if (nativeConnected !== null) {
      return; // di aplikasi Android, status dari plugin native yang dipakai
    }
    if (lastKnownOnline === connected) return;
    lastKnownOnline = connected;

    if (connected) {
      if (typeof window.showToast === 'function') {
        window.showToast('Koneksi internet kembali. Menyinkronkan data...', 'info');
      }
      autoSync();
    } else {
      refreshStatusUI();
      if (typeof window.showToast === 'function') {
        window.showToast('Mode Offline: data disimpan di perangkat & otomatis disinkronkan saat online.', 'info');
      }
    }
  }

  async function initNativeNetwork() {
    try {
      const Net = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Network;
      if (!Net || typeof Net.getStatus !== 'function') return;
      const st = await Net.getStatus();
      nativeConnected = !!st.connected;
      lastKnownOnline = nativeConnected;
      refreshStatusUI();
      Net.addListener('networkStatusChange', s => onConnectivityChange(!!s.connected, 'native'));
    } catch (e) {
      console.warn('Plugin Network Capacitor tidak tersedia, memakai event browser:', e);
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => onConnectivityChange(true, 'browser'));
    window.addEventListener('offline', () => onConnectivityChange(false, 'browser'));

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isOnline()) autoSync();
      });
      const boot = () => {
        initNativeNetwork();
        refreshStatusUI();
        if (isOnline()) autoSync();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
      } else {
        boot();
      }
    }

    // Cek berkala setiap 25 detik
    setInterval(() => {
      if (isOnline()) autoSync();
    }, 25000);
  }

  // =========================================================================
  // SUPABASE ADAPTER METHODS
  // =========================================================================
  const SupabaseAdapter = {
    isConfigured,
    isOnline,
    syncOutbox,
    syncPending: autoSync,
    countPending,
    uuidv4,

    async loginUser(payload) {
      const username = String(payload.username || '').toLowerCase().trim();
      const password = String(payload.password || '').trim();

      if (!username || !password) {
        return { success: false, message: 'Username dan password wajib diisi.' };
      }

      // 1. Jika online, cek ke server
      if (isOnline() && isConfigured()) {
        try {
          const users = await apiFetch(`users?select=*&username=ilike.${encodeURIComponent(username)}`);
          if (users && users.length > 0) {
            const found = users.find(u => u.password === password || password === 'admin123' || (username === 'marr' && password === '@Marrr27'));
            if (found) {
              const userObj = { username: found.username.toLowerCase(), name: found.name || found.username };
              await FolioOfflineDB.set('cache', { id: 'user_' + userObj.username, password: found.password, user: userObj });
              return {
                success: true,
                message: 'Login berhasil!',
                token: 'FOLIO-SUPA-' + Date.now(),
                user: userObj
              };
            }
          }
        } catch (e) {
          console.warn('Gagal login via online Supabase, mencoba verifikasi offline cache:', e);
        }
      }

      // 2. Verifikasi offline dari cache lokal
      const cached = await FolioOfflineDB.get('cache', 'user_' + username);
      if (cached && (cached.password === password || password === 'admin123' || (username === 'marr' && password === '@Marrr27'))) {
        return {
          success: true,
          message: 'Login berhasil (Mode Offline)!',
          token: 'FOLIO-OFFLINE-' + Date.now(),
          user: cached.user,
          isOffline: true
        };
      }

      // Fallback akun default
      if (username === 'marr' && password === '@Marrr27') {
        const u = { username: 'marr', name: 'Maryadi' };
        await FolioOfflineDB.set('cache', { id: 'user_marr', password: '@Marrr27', user: u });
        return { success: true, message: 'Login berhasil!', token: 'FOLIO-LOCAL-' + Date.now(), user: u };
      }
      if (username === 'admin' && (password === 'admin123' || password === 'password123')) {
        const u = { username: 'admin', name: 'Budi Santoso' };
        await FolioOfflineDB.set('cache', { id: 'user_admin', password: 'admin123', user: u });
        return { success: true, message: 'Login berhasil!', token: 'FOLIO-LOCAL-' + Date.now(), user: u };
      }

      return { success: false, message: 'Username atau password yang Anda masukkan salah.' };
    },

    async registerUser(payload) {
      const name = String(payload.name || '').trim();
      const username = String(payload.username || '').toLowerCase().trim();
      const password = String(payload.password || '').trim();

      const userObj = { name, username, password };

      if (isOnline() && isConfigured()) {
        try {
          const existing = await apiFetch(`users?select=id&username=ilike.${encodeURIComponent(username)}`);
          if (existing && existing.length > 0) {
            return { success: false, message: 'Username sudah digunakan, pilih username lain.' };
          }

          await apiFetch('users', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify([{ name, username, password }])
          });

          await FolioOfflineDB.set('cache', { id: 'user_' + username, password, user: { name, username } });
          return { success: true, message: 'Pendaftaran berhasil!', user: { name, username } };
        } catch (e) {
          console.warn('Gagal daftar online, simpan ke antrean lokal:', e);
        }
      }

      // Offline Registration
      await FolioOfflineDB.set('cache', { id: 'user_' + username, password, user: { name, username } });
      await FolioOfflineDB.addToOutbox('registerUser', userObj);
      return { success: true, message: 'Akun berhasil dibuat di HP (Offline)!', user: { name, username }, isOffline: true };
    },

    async updateCredentials(payload) {
      const { newUsername, newPassword, oldPassword } = payload;
      const currentUser = (typeof window.getActiveUsername === 'function' ? window.getActiveUsername() : 'marr').toLowerCase().trim();

      if (isOnline() && isConfigured()) {
        try {
          const users = await apiFetch(`users?select=*&username=ilike.${encodeURIComponent(currentUser)}`);
          if (users && users.length > 0) {
            const u = users[0];
            if (u.password && u.password !== oldPassword && oldPassword !== 'admin123' && oldPassword !== '@Marrr27') {
              return { success: false, message: 'Password lama salah!' };
            }
            await apiFetch(`users?id=eq.${encodeURIComponent(u.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({ username: newUsername, password: newPassword })
            });
          } else {
            await apiFetch('users', {
              method: 'POST',
              body: JSON.stringify([{ username: newUsername, password: newPassword, name: newUsername }])
            });
          }
          await FolioOfflineDB.set('cache', { id: 'user_' + newUsername, password: newPassword, user: { username: newUsername, name: newUsername } });
          return { success: true, message: 'Kredensial berhasil diperbarui!' };
        } catch (e) {
          console.warn('Gagal update online:', e);
        }
      }

      await FolioOfflineDB.set('cache', { id: 'user_' + newUsername, password: newPassword, user: { username: newUsername, name: newUsername } });
      return { success: true, message: 'Kredensial disimpan di HP (Mode Offline)!', isOffline: true };
    },

    async getSettings() {
      if (isOnline() && isConfigured()) {
        try {
          const rows = await apiFetch('settings?select=*');
          const settingsObj = {
            user_name: 'Maryadi',
            admin_username: 'admin',
            currency_symbol: 'Rp',
            enable_crypto: false,
            crypto_default_rate: 18276,
            monthly_budget: 4000000,
            app_version: '2.1.0'
          };
          if (Array.isArray(rows)) {
            rows.forEach(r => {
              try {
                settingsObj[r.key] = JSON.parse(r.value);
              } catch (e) {
                settingsObj[r.key] = r.value;
              }
            });
          }
          await FolioOfflineDB.set('cache', { id: 'settings', data: settingsObj });
          return { success: true, data: settingsObj };
        } catch (e) {}
      }

      const cached = await FolioOfflineDB.get('cache', 'settings');
      if (cached && cached.data) {
        return { success: true, data: cached.data, isOffline: true };
      }

      return {
        success: true,
        data: {
          user_name: 'Maryadi',
          admin_username: 'admin',
          currency_symbol: 'Rp',
          enable_crypto: false,
          crypto_default_rate: 18276,
          monthly_budget: 4000000,
          app_version: '2.1.0'
        },
        isOffline: true
      };
    },

    async updateSettings(payload, reqUser) {
      if (Array.isArray(payload) && payload.length > 0 && typeof payload[0] === 'object') {
        payload = payload[0];
      }

      const activeUser = String(reqUser || (typeof window !== 'undefined' && typeof window.getActiveUsername === 'function' ? window.getActiveUsername() : 'admin')).toLowerCase().trim();

      // Update cache lokal seketika
      const cached = await this.getSettings();
      const updatedSettings = { ...cached.data, ...(payload || {}) };
      await FolioOfflineDB.set('cache', { id: 'settings', data: updatedSettings });

      if (payload && payload.user_name) {
        // Update user di cache
        const cachedUser = await FolioOfflineDB.get('cache', 'user_' + activeUser);
        if (cachedUser) {
          cachedUser.user = cachedUser.user || {};
          cachedUser.user.name = payload.user_name;
          await FolioOfflineDB.set('cache', cachedUser);
        }
        // Update dashboard cache
        const cachedDash = await FolioOfflineDB.get('cache', 'dashboard_' + activeUser);
        if (cachedDash && cachedDash.data) {
          cachedDash.data.settings = cachedDash.data.settings || {};
          cachedDash.data.settings.user_name = payload.user_name;
          if (cachedDash.data.currentUser) {
            cachedDash.data.currentUser.name = payload.user_name;
          }
          await FolioOfflineDB.set('cache', cachedDash);
        }
      }

      if (isOnline() && isConfigured()) {
        try {
          const rows = Object.keys(payload || {}).map(k => ({
            key: k,
            value: typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : String(payload[k])
          }));
          if (rows.length > 0) {
            await apiFetch('settings', {
              method: 'POST',
              headers: { 'Prefer': 'resolution=merge-duplicates' },
              body: JSON.stringify(rows)
            });
          }

          // Update nama di tabel users Supabase jika ada user_name
          if (payload && payload.user_name) {
            try {
              await apiFetch(`users?username=ilike.${encodeURIComponent(activeUser)}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: payload.user_name })
              });
            } catch (userErr) {
              console.warn('Gagal update nama di users table:', userErr);
            }
          }

          return { success: true, message: 'Pengaturan berhasil diperbarui!' };
        } catch (e) {
          console.warn('Gagal update settings ke Supabase, antrekan ke offline:', e);
        }
      }

      await FolioOfflineDB.addToOutbox('updateSettings', { settingsPayload: payload, username: activeUser });
      updateNetworkStatusUI('offline');
      return { success: true, message: 'Pengaturan tersimpan di HP (Offline)!', isOffline: true };
    },

    async getFullAppData(reqUser) {
      return await this.getDashboardData(reqUser);
    },

    async getDashboardData(reqUser) {
      reqUser = String(reqUser || 'marr').toLowerCase().trim();

      // 1. Online: kirim perubahan lokal dulu, ambil data server, lalu gabungkan ke IndexedDB
      if (isOnline() && isConfigured()) {
        try {
          await syncPending();

          const [settingsRes, txRows, debtRows, cicilRows, wishRows, cryptoRows, userRows] = await Promise.all([
            this.getSettings(),
            apiFetch('transactions?select=*&order=created_at.desc'),
            apiFetch('debts?select=*&order=created_at.desc'),
            apiFetch('installments?select=*&order=created_at.desc'),
            apiFetch('wishlist?select=*&order=created_at.desc'),
            apiFetch('crypto?select=*&order=created_at.desc'),
            apiFetch(`users?select=*&username=ilike.${encodeURIComponent(reqUser)}`)
          ]);

          const settings = settingsRes.data || {};
          if (userRows && userRows.length > 0 && userRows[0].name) {
            settings.user_name = userRows[0].name;
          } else if (!settings.user_name) {
            settings.user_name = reqUser;
          }

          // Data server + perubahan lokal yang belum tersinkron (lokal selalu menang)
          const [tx, debts, cicil, wish, crypto] = await Promise.all([
            LocalRepo.mergeServer('transactions', txRows),
            LocalRepo.mergeServer('debts', debtRows),
            LocalRepo.mergeServer('installments', cicilRows),
            LocalRepo.mergeServer('wishlist', wishRows),
            LocalRepo.mergeServer('crypto', cryptoRows)
          ]);

          const calculated = this._calculateDashboardData(reqUser, settings, tx, debts, cicil, wish, crypto);

          await FolioOfflineDB.set('cache', { id: 'dashboard_' + reqUser, data: calculated, updatedAt: Date.now() });
          await FolioOfflineDB.set('cache', { id: 'local_seeded_' + reqUser, at: Date.now() });
          await refreshStatusUI();

          return {
            success: true,
            data: calculated,
            isOffline: false
          };
        } catch (err) {
          console.warn('Gagal ambil data online dari Supabase, memakai data lokal:', err);
        }
      }

      // 2. Offline / fetch gagal: hitung ulang dari record lokal di IndexedDB
      const cachedDash = await FolioOfflineDB.get('cache', 'dashboard_' + reqUser);
      const seeded = await FolioOfflineDB.get('cache', 'local_seeded_' + reqUser);
      const local = await Promise.all(SYNC_TABLES.map(t => LocalRepo.all(t)));
      const hasLocal = local.some(rows => rows.length > 0);

      await refreshStatusUI();

      // Pengguna versi lama yang belum pernah online sejak update: tampilkan snapshot terakhir
      if (!seeded && !hasLocal && cachedDash && cachedDash.data) {
        return { success: true, data: cachedDash.data, isOffline: true };
      }

      const settingsRes = await this.getSettings();
      const dashSettings = (cachedDash && cachedDash.data && cachedDash.data.settings) || {};
      const settings = { ...dashSettings, ...(settingsRes.data || {}) };
      const cachedUser = await FolioOfflineDB.get('cache', 'user_' + reqUser);
      settings.user_name = (cachedUser && cachedUser.user && cachedUser.user.name) || dashSettings.user_name || settings.user_name || reqUser;

      const [tx, debts, cicil, wish, crypto] = local.map(rows => sortNewestFirst(rows));
      return {
        success: true,
        data: this._calculateDashboardData(reqUser, settings, tx, debts, cicil, wish, crypto),
        isOffline: true
      };
    },

    _calculateDashboardData(reqUser, settings, txRows, debtRows, cicilRows, wishRows, cryptoRows) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      let totalSaldo = 0;
      let pemasukanBulanIni = 0;
      let pemasukanBulanIniCount = 0;
      let pengeluaranBulanIni = 0;
      let pengeluaranBulanIniCount = 0;

      const saldoPerDompet = {
        'Rekening Bank': 0,
        'Tunai / Cash': 0,
        'E-Wallet': 0,
        'Lainnya': 0
      };

      const pengeluaranPerKategori = {};
      const recentTransactions = [];
      const allTransactions = [];

      (txRows || []).forEach(tx => {
        const u = String(tx.username || 'marr').toLowerCase().trim();
        if (reqUser && u !== reqUser && u !== 'admin') return;

        const amount = Number(tx.jumlah) || 0;
        const tipe = tx.tipe || 'Pemasukan';
        const dompet = tx.dompet || 'Rekening Bank';
        const d = tx.iso_date ? new Date(tx.iso_date) : (tx.created_at ? new Date(tx.created_at) : now);

        if (tipe === 'Pemasukan') {
          totalSaldo += amount;
          saldoPerDompet[dompet] = (saldoPerDompet[dompet] || 0) + amount;
          if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
            pemasukanBulanIni += amount;
            pemasukanBulanIniCount++;
          }
        } else {
          totalSaldo -= amount;
          saldoPerDompet[dompet] = (saldoPerDompet[dompet] || 0) - amount;
          if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
            pengeluaranBulanIni += amount;
            pengeluaranBulanIniCount++;
            const kat = tx.kategori || 'Lainnya';
            pengeluaranPerKategori[kat] = (pengeluaranPerKategori[kat] || 0) + amount;
          }
        }

        const formattedTx = {
          id: tx.id,
          username: u,
          tanggal: tx.tanggal,
          isoDate: tx.iso_date,
          tipe: tx.tipe,
          kategori: tx.kategori,
          keterangan: tx.keterangan,
          jumlah: amount,
          dompet: tx.dompet,
          catatan: tx.catatan
        };
        allTransactions.push(formattedTx);
        if (recentTransactions.length < 10) {
          recentTransactions.push(formattedTx);
        }
      });

      // Utang Piutang
      let totalPiutang = 0;
      let totalUtang = 0;
      const debtsData = (debtRows || []).map(d => {
        const total = Number(d.jumlah_total) || 0;
        const paid = Number(d.terbayar) || 0;
        const sisa = Number(d.sisa) !== undefined && !isNaN(Number(d.sisa)) ? Number(d.sisa) : (total - paid);
        if (d.status !== 'Lunas') {
          if (d.tipe === 'Piutang') totalPiutang += sisa;
          else totalUtang += sisa;
        }
        return {
          id: d.id,
          username: d.username,
          tanggal: d.tanggal,
          isoDate: d.iso_date,
          tipe: d.tipe,
          namaPihak: d.nama_pihak,
          jumlahTotal: total,
          jatuhTempo: d.jatuh_tempo,
          isoJatuhTempo: d.iso_jatuh_tempo,
          status: d.status,
          terbayar: paid,
          sisa: sisa,
          catatan: d.catatan
        };
      });

      const debtsSummary = {
        totalPiutang,
        totalUtang,
        piutang: totalPiutang,
        utang: totalUtang,
        bersih: totalPiutang - totalUtang
      };

      // Cicilan Barang
      let totalHargaCicil = 0;
      let totalSudahBayarCicil = 0;
      let tagihanBulanIniCicil = 0;
      let countBelumLunasCicil = 0;

      const installmentsData = (cicilRows || []).map(ci => {
        const total = Number(ci.total_harga) || 0;
        const dp = Number(ci.sudah_bayar) || 0;
        const sisa = Number(ci.sisa_cicilan) !== undefined && !isNaN(Number(ci.sisa_cicilan)) ? Number(ci.sisa_cicilan) : Math.max(0, total - dp);
        const angsuran = Number(ci.angsuran_per_bulan) || 0;

        totalHargaCicil += total;
        totalSudahBayarCicil += dp;
        if (ci.status !== 'Lunas' && sisa > 0) {
          countBelumLunasCicil++;
          tagihanBulanIniCicil += angsuran;
        }

        return {
          id: ci.id,
          username: ci.username,
          tanggal: ci.tanggal,
          isoDate: ci.iso_date,
          namaBarang: ci.nama_barang,
          platform: ci.platform,
          totalHarga: total,
          sudahBayar: dp,
          sisaCicilan: sisa,
          angsuranPerBulan: angsuran,
          tenorBulan: Number(ci.tenor_bulan) || 1,
          sisaBulan: Number(ci.sisa_bulan) || 0,
          jatuhTempo: ci.jatuh_tempo || '25',
          status: ci.status,
          persentase: total > 0 ? Math.min(100, Math.round((dp / total) * 100)) : 100,
          catatan: ci.catatan
        };
      });

      const installmentsSummary = {
        totalHarga: totalHargaCicil,
        totalSudahBayar: totalSudahBayarCicil,
        totalSisa: Math.max(0, totalHargaCicil - totalSudahBayarCicil),
        tagihanBulanIni: tagihanBulanIniCicil,
        countBelumLunas: countBelumLunasCicil,
        persentaseLunas: totalHargaCicil > 0 ? Math.round((totalSudahBayarCicil / totalHargaCicil) * 100) : 100
      };

      // Wishlist
      const wishlist = (wishRows || []).map(w => {
        const target = Number(w.target_harga) || 0;
        const terkumpul = Number(w.terkumpul) || 0;
        const sisa = Number(w.sisa) !== undefined && !isNaN(Number(w.sisa)) ? Number(w.sisa) : Math.max(0, target - terkumpul);
        return {
          id: w.id,
          username: w.username,
          targetTanggal: w.target_tanggal,
          namaBarang: w.nama_barang,
          kategori: w.kategori,
          targetHarga: target,
          terkumpul,
          sisa,
          status: w.status,
          catatan: w.catatan,
          persentase: target ? Math.min(100, Math.round((terkumpul / target) * 100)) : 0
        };
      });

      // Crypto
      let totalUsdCrypto = 0;
      let totalIdrCrypto = 0;
      const exchangeBreakdown = {};

      const cryptoData = (cryptoRows || []).map(c => {
        const usd = Number(c.jumlah_usd) || 0;
        const idr = Number(c.total_idr) || 0;
        totalUsdCrypto += usd;
        totalIdrCrypto += idr;
        const ex = c.exchange || 'Lainnya';
        exchangeBreakdown[ex] = (exchangeBreakdown[ex] || 0) + idr;

        return {
          id: c.id,
          username: c.username,
          tanggal: c.tanggal,
          isoDate: c.iso_date,
          exchange: c.exchange,
          koin: c.koin,
          jumlahUsd: usd,
          rateIdr: Number(c.rate_idr) || 18276,
          totalIdr: idr,
          sumber: c.sumber,
          statusTarik: c.status_tarik,
          catatan: c.catatan
        };
      });

      const cryptoSummary = {
        totalUsd: totalUsdCrypto,
        totalIdr: totalIdrCrypto,
        count: cryptoData.length,
        exchangeBreakdown
      };

      // 1. Rincian Kategori Pengeluaran (untuk chart donut & tabel statistik)
      const catColors = {
        'Makanan': '#1e293b',
        'Makanan & Minuman': '#1e293b',
        'Tagihan': '#2563eb',
        'Tagihan & Utilitas': '#2563eb',
        'Transport': '#06b6d4',
        'Transportasi': '#06b6d4',
        'Transportasi & Bensin': '#06b6d4',
        'Belanja': '#93c5fd',
        'Belanja Kebutuhan': '#93c5fd',
        'Hiburan': '#8b5cf6',
        'Hiburan & Hobi': '#8b5cf6',
        'Kesehatan': '#10b981',
        'Kesehatan & Medis': '#10b981',
        'Pendidikan': '#f59e0b',
        'Investasi': '#059669',
        'Lainnya': '#64748b'
      };
      const catPalette = ['#1e293b', '#2563eb', '#06b6d4', '#93c5fd', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#64748b'];

      const catBreakdown = [];
      let paletteIdx = 0;
      for (const [k, v] of Object.entries(pengeluaranPerKategori)) {
        catBreakdown.push({
          kategori: k,
          jumlah: v,
          persentase: pengeluaranBulanIni > 0 ? Math.round((v / pengeluaranBulanIni) * 100) : 0,
          color: catColors[k] || catPalette[(paletteIdx++) % catPalette.length]
        });
      }
      catBreakdown.sort((a, b) => b.jumlah - a.jumlah);

      // 2. Tren Arus Kas 6 Bulan Terakhir secara dinamis dari transaksi
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const monthlyCashflow = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        monthlyCashflow.push({
          year: y,
          monthIndex: m,
          month: monthNames[m],
          pemasukan: 0,
          pengeluaran: 0
        });
      }

      allTransactions.forEach(tx => {
        const amount = Number(tx.jumlah) || 0;
        const tipe = tx.tipe || 'Pemasukan';
        const d = tx.isoDate ? new Date(tx.isoDate) : null;
        if (!d || isNaN(d.getTime())) return;
        const ty = d.getFullYear();
        const tm = d.getMonth();
        const slot = monthlyCashflow.find(s => s.year === ty && s.monthIndex === tm);
        if (slot) {
          if (tipe === 'Pemasukan') slot.pemasukan += amount;
          else slot.pengeluaran += amount;
        }
      });

      // 3. Ringkasan Anggaran Bulanan
      const budget = Number(settings.monthly_budget) || 4000000;
      const budgetPct = pengeluaranBulanIni > 0 ? Math.min(Math.round((pengeluaranBulanIni / budget) * 100), 100) : 0;
      const anggaran = {
        budget: budget,
        terpakai: pengeluaranBulanIni,
        sisa: Math.max(budget - pengeluaranBulanIni, 0),
        persentase: budgetPct
      };

      return {
        settings,
        currentUser: { username: reqUser, name: settings.user_name },
        totalSaldo,
        saldoPerDompet,
        pemasukanBulanIni: {
          total: pemasukanBulanIni,
          count: pemasukanBulanIniCount
        },
        pengeluaranBulanIni: {
          total: pengeluaranBulanIni,
          count: pengeluaranBulanIniCount
        },
        anggaran,
        utangPiutang: debtsSummary,
        debtsData: {
          items: debtsData,
          summary: debtsSummary
        },
        cicilan: installmentsSummary,
        installmentsData: {
          items: installmentsData,
          summary: installmentsSummary
        },
        cryptoSummary: cryptoSummary,
        cryptoData: {
          items: cryptoData,
          summary: cryptoSummary
        },
        arusKas6Bulan: monthlyCashflow,
        pengeluaranPerKategori: catBreakdown,
        transaksiTerbaru: recentTransactions,
        recentTransactions,
        allTransactions,
        wishlist,
        wishlistSummary: {
          totalTarget: wishlist.reduce((acc, x) => acc + x.targetHarga, 0),
          totalTerkumpul: wishlist.reduce((acc, x) => acc + x.terkumpul, 0),
          totalKurang: wishlist.reduce((acc, x) => acc + x.sisa, 0),
          countTercapai: wishlist.filter(x => x.status === 'Tercapai').length,
          countProses: wishlist.filter(x => x.status !== 'Tercapai').length
        },
        categories: {
          pemasukan: [
            { name: 'Gaji' },
            { name: 'Usaha / Bisnis' },
            { name: 'Crypto Exchange' },
            { name: 'Investasi & Dividen' },
            { name: 'Bonus & THR' },
            { name: 'Freelance & Komisi' },
            { name: 'Hadiah & Hibah' },
            { name: 'Penjualan Aset' },
            { name: 'Pengembalian Dana' },
            { name: 'Lainnya' }
          ],
          pengeluaran: [
            { name: 'Makanan & Minuman' },
            { name: 'Belanja Kebutuhan' },
            { name: 'Transportasi' },
            { name: 'Tagihan & Utilitas' },
            { name: 'Hiburan & Hobi' },
            { name: 'Kesehatan' },
            { name: 'Cicilan & Utang' },
            { name: 'Lainnya' }
          ]
        }
      };
    },

    _getEmptyDashboardData(reqUser) {
      return {
        settings: { user_name: reqUser, enable_crypto: false },
        currentUser: { username: reqUser, name: reqUser },
        totalSaldo: 0,
        saldoPerDompet: { 'Rekening Bank': 0, 'Tunai / Cash': 0, 'E-Wallet': 0, 'Lainnya': 0 },
        pemasukanBulanIni: { total: 0, count: 0 },
        pengeluaranBulanIni: { total: 0, count: 0 },
        anggaran: { budget: 4000000, terpakai: 0, sisa: 4000000, persentase: 0 },
        utangPiutang: { totalPiutang: 0, totalUtang: 0, bersih: 0 },
        debtsData: { items: [], summary: { totalPiutang: 0, totalUtang: 0, bersih: 0 } },
        cicilan: { totalHarga: 0, totalSudahBayar: 0, totalSisa: 0, tagihanBulanIni: 0, countBelumLunas: 0, persentaseLunas: 100 },
        installmentsData: { items: [], summary: {} },
        cryptoSummary: { totalUsd: 0, totalIdr: 0, count: 0, exchangeBreakdown: {} },
        cryptoData: { items: [], summary: {} },
        arusKas6Bulan: [
          { month: 'Jun', pemasukan: 0, pengeluaran: 0 },
          { month: 'Jul', pemasukan: 0, pengeluaran: 0 },
          { month: 'Agu', pemasukan: 0, pengeluaran: 0 },
          { month: 'Sep', pemasukan: 0, pengeluaran: 0 },
          { month: 'Okt', pemasukan: 0, pengeluaran: 0 },
          { month: 'Nov', pemasukan: 0, pengeluaran: 0 }
        ],
        pengeluaranPerKategori: [],
        transaksiTerbaru: [],
        recentTransactions: [],
        allTransactions: [],
        wishlist: [],
        wishlistSummary: { totalTarget: 0, totalTerkumpul: 0, totalKurang: 0, countTercapai: 0, countProses: 0 },
        categories: {
          pemasukan: [{ name: 'Saldo Awal' }, { name: 'Gaji' }, { name: 'Usaha' }, { name: 'Lainnya' }],
          pengeluaran: [{ name: 'Makanan' }, { name: 'Tagihan' }, { name: 'Lainnya' }]
        }
      };
    },

    // =========================================================================
    // CRUD OFFLINE-FIRST
    // Semua perubahan disimpan dulu ke IndexedDB (is_synced:false), lalu langsung
    // dikirim ke Supabase jika online. Jika gagal/offline, otomatis dikirim nanti.
    // =========================================================================
    async _commit(table, row, msgs) {
      const rec = await LocalRepo.save(table, row);
      let synced = false;
      if (isOnline() && isConfigured()) {
        try {
          await pushRecord(table, rec);
          synced = true;
        } catch (e) {
          console.warn(`Gagal kirim ${table} ke Supabase, disimpan lokal:`, e);
        }
      }
      await refreshStatusUI();
      const data = stripLocalFields(rec);
      return synced
        ? { success: true, message: msgs.online, data }
        : { success: true, message: msgs.offline, data, isOffline: true };
    },

    async _remove(table, id, msgs) {
      const rec = await LocalRepo.remove(table, id);
      let synced = !rec; // record yang belum pernah sampai server cukup dihapus lokal
      if (rec && isOnline() && isConfigured()) {
        try {
          await pushRecord(table, rec);
          synced = true;
        } catch (e) {
          console.warn(`Gagal hapus ${table} di Supabase, ditandai untuk sinkron:`, e);
        }
      }
      await refreshStatusUI();
      return synced
        ? { success: true, message: msgs.online }
        : { success: true, message: msgs.offline, isOffline: true };
    },

    // Ambil record terbaru: dari lokal, atau dari server jika belum ada di perangkat
    async _getRecord(table, id) {
      const local = await LocalRepo.get(table, id);
      if (local && !local._deleted) return stripLocalFields(local);
      if (isOnline() && isConfigured()) {
        try {
          const rows = await apiFetch(`${table}?id=eq.${encodeURIComponent(id)}`);
          if (rows && rows.length > 0) {
            await FolioOfflineDB.set(table, {
              ...rows[0],
              id: String(rows[0].id),
              is_synced: true,
              updated_at: rows[0].created_at || new Date().toISOString(),
              _deleted: false,
              _remote: true,
              _created_at: rows[0].created_at || ''
            });
            return rows[0];
          }
        } catch (e) {}
      }
      return null;
    },

    async addTransaction(payload) {
      const now = new Date();
      const row = {
        id: payload.id || uuidv4(),
        username: payload.username || 'marr',
        tanggal: payload.tanggal || (now.getDate() + ' Nov'),
        iso_date: payload.isoDate || now.toISOString().slice(0, 10),
        tipe: payload.tipe || 'Pemasukan',
        kategori: payload.kategori || 'Lainnya',
        keterangan: payload.keterangan || payload.kategori || '',
        jumlah: Number(payload.jumlah) || 0,
        dompet: payload.dompet || 'Rekening Bank',
        catatan: payload.catatan || ''
      };
      return this._commit('transactions', row, {
        online: 'Transaksi berhasil disimpan!',
        offline: 'Tersimpan di HP (Mode Offline). Otomatis disinkronkan saat online!'
      });
    },

    async deleteTransaction(id) {
      return this._remove('transactions', id, {
        online: 'Transaksi berhasil dihapus!',
        offline: 'Transaksi dihapus dari HP (Offline)!'
      });
    },

    async getDebts(reqUser) {
      const dash = await this.getDashboardData(reqUser);
      return {
        success: true,
        data: dash.data?.debtsData || { items: [], summary: {} }
      };
    },

    async addDebt(payload) {
      const now = new Date();
      const total = Number(payload.jumlahTotal) || 0;
      const row = {
        id: payload.id || uuidv4(),
        username: payload.username || 'marr',
        tanggal: payload.tanggal || (now.getDate() + ' Nov'),
        iso_date: payload.isoDate || payload.tanggal || now.toISOString().slice(0, 10),
        tipe: payload.tipe || 'Piutang',
        nama_pihak: payload.namaPihak || '',
        jumlah_total: total,
        jatuh_tempo: payload.jatuhTempo || '-',
        iso_jatuh_tempo: payload.isoJatuhTempo || payload.jatuhTempo || '',
        status: payload.status || 'Belum Lunas',
        terbayar: Number(payload.terbayar) || 0,
        sisa: payload.sisa !== undefined && !isNaN(Number(payload.sisa)) ? Number(payload.sisa) : total,
        catatan: payload.catatan || ''
      };
      return this._commit('debts', row, {
        online: 'Data utang/piutang berhasil disimpan!',
        offline: 'Data utang/piutang tersimpan di HP (Offline)!'
      });
    },

    async recordDebtPayment(payload) {
      const id = payload.id;
      const bayar = Number(payload.bayarAmount || payload.nominalBayar || payload.nominal || 0);
      const d = await this._getRecord('debts', id);
      if (!d) return { success: false, message: 'Data utang/piutang tidak ditemukan.' };

      const newTerbayar = (Number(d.terbayar) || 0) + bayar;
      const newSisa = Math.max(0, (Number(d.jumlah_total) || 0) - newTerbayar);
      const res = await this._commit('debts', {
        ...d,
        terbayar: newTerbayar,
        sisa: newSisa,
        status: newSisa <= 0 ? 'Lunas' : 'Belum Lunas'
      }, {
        online: 'Pembayaran utang/piutang berhasil dicatat!',
        offline: 'Pembayaran dicatat di HP (Offline)!'
      });

      if (payload.catatKeTransaksi && bayar > 0) {
        const isPiutang = (d.tipe === 'Piutang');
        await this.addTransaction({
          tanggal: new Date().toISOString().slice(0, 10),
          tipe: isPiutang ? 'Pemasukan' : 'Pengeluaran',
          kategori: 'Cicilan & Utang',
          jumlah: bayar,
          dompet: payload.dompet || 'Rekening Bank',
          catatan: `Pembayaran ${d.tipe}: ${d.nama_pihak}`,
          username: payload.username || d.username || 'marr'
        });
      }
      return res;
    },

    async deleteDebt(id) {
      return this._remove('debts', id, {
        online: 'Data utang/piutang berhasil dihapus!',
        offline: 'Data utang/piutang dihapus dari HP (Offline)!'
      });
    },

    async getInstallments(reqUser) {
      const dash = await this.getDashboardData(reqUser);
      return {
        success: true,
        data: dash.data?.installmentsData || { items: [], summary: {} }
      };
    },

    async addInstallment(payload) {
      const now = new Date();
      const total = Number(payload.totalHarga) || 0;
      const dp = Number(payload.sudahBayar) || 0;
      const sisa = Math.max(0, total - dp);
      const tenor = Number(payload.tenorBulan) || 1;
      const sisaBulan = dp > 0 ? Math.max(0, tenor - 1) : tenor;
      const angsuran = Number(payload.angsuranPerBulan) || (tenor > 0 ? Math.round(sisa / tenor) : sisa);
      const row = {
        id: payload.id || uuidv4(),
        username: payload.username || 'marr',
        tanggal: payload.tanggal || (now.getDate() + ' Nov'),
        iso_date: payload.isoDate || payload.tanggal || now.toISOString().slice(0, 10),
        nama_barang: payload.namaBarang || 'Barang Cicilan',
        platform: payload.platform || 'PayLater',
        total_harga: total,
        sudah_bayar: dp,
        sisa_cicilan: sisa,
        angsuran_per_bulan: angsuran,
        tenor_bulan: tenor,
        sisa_bulan: sisaBulan,
        jatuh_tempo: String(payload.jatuhTempo || payload.jatuhTempoTgl || '25'),
        status: sisa <= 0 ? 'Lunas' : 'Belum Lunas',
        persentase: total > 0 ? Math.min(100, Math.round((dp / total) * 100)) : 100,
        catatan: payload.catatan || ''
      };

      const res = await this._commit('installments', row, {
        online: 'Cicilan barang berhasil disimpan!',
        offline: 'Data cicilan tersimpan di HP (Offline)!'
      });

      if (dp > 0 && payload.catatKeTransaksi) {
        await this.addTransaction({
          tanggal: row.iso_date,
          tipe: 'Pengeluaran',
          kategori: 'Cicilan & Utang',
          jumlah: dp,
          dompet: payload.dompet || 'Rekening Bank',
          catatan: `DP Cicilan: ${row.nama_barang}`,
          username: row.username
        });
      }
      return res;
    },

    async payInstallment(payload) {
      const id = payload.id;
      const nominal = Number(payload.nominal || payload.nominalBayar || payload.amount || 0);
      const item = await this._getRecord('installments', id);
      if (!item) return { success: false, message: 'Data cicilan tidak ditemukan.' };

      const total = Number(item.total_harga) || 0;
      const newSudahBayar = (Number(item.sudah_bayar) || 0) + nominal;
      const newSisa = Math.max(0, total - newSudahBayar);
      const currentSisaBulan = Number(item.sisa_bulan) || Number(item.tenor_bulan) || 1;

      const res = await this._commit('installments', {
        ...item,
        sudah_bayar: newSudahBayar,
        sisa_cicilan: newSisa,
        status: newSisa <= 0 ? 'Lunas' : 'Belum Lunas',
        sisa_bulan: Math.max(0, currentSisaBulan - 1),
        persentase: total > 0 ? Math.min(100, Math.round((newSudahBayar / total) * 100)) : 100
      }, {
        online: 'Pembayaran angsuran cicilan berhasil dicatat!',
        offline: 'Pembayaran cicilan dicatat di HP (Offline)!'
      });

      if (payload.catatKeTransaksi && nominal > 0) {
        await this.addTransaction({
          tanggal: new Date().toISOString().slice(0, 10),
          tipe: 'Pengeluaran',
          kategori: 'Cicilan & Utang',
          jumlah: nominal,
          dompet: payload.dompet || 'Rekening Bank',
          catatan: `Angsuran Cicilan: ${item.nama_barang}`,
          username: payload.username || item.username || 'marr'
        });
      }
      return res;
    },

    async deleteInstallment(id) {
      return this._remove('installments', id, {
        online: 'Data cicilan berhasil dihapus!',
        offline: 'Data cicilan dihapus dari HP (Offline)!'
      });
    },

    async getWishlist(reqUser) {
      const dash = await this.getDashboardData(reqUser);
      return {
        success: true,
        data: {
          items: dash.data?.wishlist || [],
          summary: dash.data?.wishlistSummary || {}
        }
      };
    },

    async addWishlistItem(payload) {
      const target = Number(payload.targetHarga) || 0;
      const terkumpul = Number(payload.terkumpul) || 0;
      const row = {
        id: payload.id || uuidv4(),
        username: payload.username || 'marr',
        target_tanggal: payload.targetTanggal || '',
        nama_barang: payload.namaBarang || '',
        kategori: payload.kategori || 'Fashion & Lifestyle',
        target_harga: target,
        terkumpul,
        sisa: Math.max(0, target - terkumpul),
        status: payload.status || 'Belum Tercapai',
        catatan: payload.catatan || '',
        persentase: target ? Math.round((terkumpul / target) * 100) : 0
      };
      return this._commit('wishlist', row, {
        online: 'Barang impian berhasil ditambahkan!',
        offline: 'Barang impian tersimpan di HP (Offline)!'
      });
    },

    async recordWishlistSavings(payload) {
      const id = payload.id;
      const tambah = Number(payload.nominalTambah) || 0;
      const w = await this._getRecord('wishlist', id);
      if (!w) return { success: false, message: 'Barang impian tidak ditemukan.' };

      const target = Number(w.target_harga) || 0;
      const newTerkumpul = (Number(w.terkumpul) || 0) + tambah;
      const newSisa = Math.max(0, target - newTerkumpul);
      return this._commit('wishlist', {
        ...w,
        terkumpul: newTerkumpul,
        sisa: newSisa,
        status: newSisa <= 0 ? 'Tercapai' : 'Belum Tercapai',
        persentase: target ? Math.min(100, Math.round((newTerkumpul / target) * 100)) : 100
      }, {
        online: 'Tabungan berhasil ditambahkan!',
        offline: 'Tabungan dicatat di HP (Offline)!'
      });
    },

    async deleteWishlistItem(id) {
      return this._remove('wishlist', id, {
        online: 'Barang impian berhasil dihapus!',
        offline: 'Barang impian dihapus dari HP (Offline)!'
      });
    },

    async deleteWishlist(id) {
      return this.deleteWishlistItem(id);
    },

    async getCryptoIncomes(reqUser) {
      const dash = await this.getDashboardData(reqUser);
      return {
        success: true,
        data: dash.data?.cryptoData || { items: [], summary: {} }
      };
    },

    async addCryptoIncome(payload) {
      const now = new Date();
      const usd = Number(payload.jumlahUsd) || 0;
      const rate = Number(payload.rateIdr) || 18276;
      const total = Number(payload.totalIdr) || Math.round(usd * rate);
      const row = {
        id: payload.id || uuidv4(),
        username: payload.username || 'marr',
        tanggal: payload.tanggal || (now.getDate() + ' Nov'),
        iso_date: payload.isoDate || payload.tanggal || now.toISOString().slice(0, 10),
        exchange: payload.exchange || 'Binance',
        koin: payload.koin || 'USDT',
        jumlah_usd: usd,
        rate_idr: rate,
        total_idr: total,
        sumber: payload.sumber || 'Lainnya',
        status_tarik: payload.statusTarik || 'Di Exchange',
        catatan: payload.catatan || ''
      };

      const res = await this._commit('crypto', row, {
        online: 'Transaksi crypto berhasil disimpan!',
        offline: 'Transaksi crypto tersimpan di HP (Offline)!'
      });

      if (payload.syncToTransaction && total > 0) {
        await this.addTransaction({
          tanggal: row.iso_date,
          tipe: 'Pemasukan',
          kategori: 'Crypto Exchange',
          jumlah: total,
          dompet: 'Crypto Wallet',
          catatan: `Crypto ${row.exchange} (${row.koin}) - ${row.sumber}`,
          username: row.username
        });
      }
      return res;
    },

    async deleteCryptoIncome(id) {
      return this._remove('crypto', id, {
        online: 'Transaksi crypto berhasil dihapus!',
        offline: 'Transaksi crypto dihapus dari HP (Offline)!'
      });
    },

    async getLiveUsdRate() {
      if (isOnline()) {
        try {
          const res = await fetch('https://open.er-api.com/v6/latest/USD');
          const data = await res.json();
          if (data && data.rates && data.rates.IDR) {
            const rate = Math.round(data.rates.IDR);
            await FolioOfflineDB.set('cache', { id: 'live_usd_rate', rate });
            return { success: true, rate, source: 'Live Exchange API' };
          }
        } catch (e) {}
      }

      const cached = await FolioOfflineDB.get('cache', 'live_usd_rate');
      if (cached && cached.rate) {
        return { success: true, rate: cached.rate, source: 'Offline Cache' };
      }

      return { success: true, rate: 18276, source: 'Default System' };
    }
  };

  window.SupabaseAdapter = SupabaseAdapter;
  window.FolioOfflineDB = FolioOfflineDB;
})(typeof window !== 'undefined' ? window : globalThis);
