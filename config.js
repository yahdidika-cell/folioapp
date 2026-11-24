// =========================================================================
// KONFIGURASI DATABASE UTAMA: SUPABASE (FOLIO SMART)
// =========================================================================
var SUPABASE_URL = "https://nlwgmzixmwmvfpjaehlo.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_RxG_Wi9rxOYhwJfIWKoZZA_bB6dJjem";

// =========================================================================
// KONFIGURASI CADANGAN: GOOGLE APPS SCRIPT (DUAL-SYNC / BACKUP TETAP AMAN)
// =========================================================================
var GANTISC = "https://script.google.com/macros/s/AKfycbzal7ilMNjh2AUS1AP_g6ew80x0AlfoKcCAz5Md5hG0M9qwoQM_g-SgqCwIYIICUNWE/exec";

if (typeof window !== "undefined") {
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  window.GANTISC = GANTISC;
}
