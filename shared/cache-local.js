/**
 * Smart Translator - Lokaler Cache (localStorage)
 * Eigenstaendiges Modul fuer die lokale Cache-Verwaltung.
 */

window.SMT = window.SMT || {};

SMT.CacheLocal = {
  PREFIX: 'smt_cache_',

  /**
   * Prueft ob lokaler Cache fuer eine Seite vorhanden ist
   */
  checkCache(cacheKey) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (data?.translations && Object.keys(data.translations).length > 0) {
          return {
            hasCache: true,
            count: Object.keys(data.translations).length,
            percentage: 100
          };
        }
      }
    } catch (e) {
      console.warn('[CacheLocal] Check error:', e);
    }
    return { hasCache: false, count: 0, percentage: 0 };
  },

  /**
   * Laedt Uebersetzungen aus lokalem Cache
   */
  loadTranslations(cacheKey) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        return data?.translations || {};
      }
    } catch (e) {
      console.warn('[CacheLocal] Load error:', e);
    }
    return {};
  },

  /**
   * Speichert Uebersetzungen im lokalen Cache
   */
  saveTranslations(cacheKey, pageUrl, items) {
    try {
      let data = { url: pageUrl, translations: {}, timestamp: Date.now() };
      try {
        const existing = localStorage.getItem(cacheKey);
        if (existing) {
          data = JSON.parse(existing);
        }
      } catch (e) {}

      for (const item of items) {
        if (item.original && item.translated && item.original !== item.translated) {
          data.translations[item.original] = item.translated;
        }
      }

      data.timestamp = Date.now();
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      console.warn('[CacheLocal] Save error:', e);
    }
  },

  /**
   * Loescht Cache-Eintraege
   * @param {string|null} cacheKey - Einzelner Key oder null fuer alle
   */
  clearCache(cacheKey) {
    if (cacheKey) {
      localStorage.removeItem(cacheKey);
      return { deleted: 1 };
    }

    // Alle Cache-Eintraege loeschen
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach(k => localStorage.removeItem(k));
    return { deleted: keys.length };
  },

  /**
   * Gibt alle lokalen Cache-Eintraege zurueck (fuer UI)
   */
  getEntries() {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data?.translations) {
            entries.push({
              key,
              url: data.url || 'Unbekannt',
              count: Object.keys(data.translations).length,
              timestamp: data.timestamp || 0,
              size: localStorage.getItem(key).length
            });
          }
        } catch (e) {}
      }
    }
    return entries;
  },

  /**
   * Berechnet den gesamten localStorage-Verbrauch fuer Cache
   */
  getStorageUsage() {
    let totalSize = 0;
    let entryCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.PREFIX)) {
        totalSize += localStorage.getItem(key).length * 2; // UTF-16
        entryCount++;
      }
    }
    return { bytes: totalSize, entries: entryCount };
  }
};
