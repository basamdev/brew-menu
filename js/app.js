// App.js — Shawarma Premium Menu
// Handles: i18n, theme, category filtering, product detail modal, video player

window.openMenu = function (lang) {
    localStorage.setItem('selectedLang', lang);
    window.location.href = 'menu.html?lang=' + lang;
};

function getMenuLicenseExpireDate() {
    try { localStorage.removeItem('menuExpireDate'); } catch (e) { /* ignore */ }
    var license = window.MENU_LICENSE || {};
    return String(license.expireDate || '').trim();
}

function isMenuExpirePreviewRequested() {
    try {
        var params = new URLSearchParams(window.location.search || '');
        var flag = (params.get('expired') || params.get('preview') || '').toLowerCase();
        return flag === '1' || flag === 'true' || flag === 'expired' || flag === 'yes';
    } catch (e) {
        return false;
    }
}

function getMenuExpireEndMs(dateStr) {
    var raw = String(dateStr || '').trim();
    if (!raw) return null;
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
        var parsed = Date.parse(raw);
        return isNaN(parsed) ? null : parsed;
    }
    var end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
    return end.getTime();
}

window.getMenuLicenseExpireDate = getMenuLicenseExpireDate;
window.isMenuExpirePreviewRequested = isMenuExpirePreviewRequested;
window.getMenuExpireEndMs = getMenuExpireEndMs;

// Immediately reclaim space from duplicate/redundant cache keys
try { localStorage.removeItem('cachedCashierItems'); } catch (e) {}

// Self-heal corrupted cache if previous version stripped images
try {
    var _rawCachedApp = localStorage.getItem('cachedMenuItems');
    if (_rawCachedApp) {
        var _parsedCachedApp = JSON.parse(_rawCachedApp);
        if (Array.isArray(_parsedCachedApp) && _parsedCachedApp.length > 0) {
            var _withImgApp = _parsedCachedApp.filter(function (it) { return it && it.image; }).length;
            if (_withImgApp === 0) {
                localStorage.removeItem('cachedMenuItems');
            }
        }
    }
} catch (e) {}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || '')) {
            evictNonEssentialCacheKeys();
            try {
                localStorage.setItem(key, value);
                return;
            } catch (e2) {}

            try {
                localStorage.removeItem('cachedSales');
                localStorage.removeItem('cachedExpenses');
                localStorage.removeItem('cachedFavorites');
                localStorage.removeItem('menu_ratings');
                localStorage.setItem(key, value);
            } catch (e3) {
                // Keep running in memory with full data
            }
        }
    }
}

// Keys that can be dropped to free space when the quota is hit. `cachedCategories`
// and `cachedMenuItems` are intentionally excluded to keep the menu UI intact.
var NON_ESSENTIAL_CACHE_KEYS = [
    'cachedCashierItems',
    'cachedMenuItemsSig',
    'cachedMenuCategoryNames',
    'cachedSales',
    'cachedExpenses',
    'cachedFavorites',
    'menu_ratings'
];

function evictNonEssentialCacheKeys() {
    NON_ESSENTIAL_CACHE_KEYS.forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
    });
}

/* ==========================================================================
   SMARTSERVE RESTAURANT-SPECIFIC MENU CACHE (Requirements 1 - 14)
   ========================================================================== */

var MenuCache = (function () {
    var CACHE_PREFIX = 'smartserve_menu_cache_';
    var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL
    var CURRENT_SCHEMA_VERSION = 2;

    function getStorageKey(restaurantId) {
        var rId = String(restaurantId || '').trim().toLowerCase() || 'brew-coffee';
        return CACHE_PREFIX + rId;
    }

    function isValid(cache, targetRestaurantId) {
        if (!cache || typeof cache !== 'object') return false;
        var rId = String(targetRestaurantId || '').trim().toLowerCase() || 'brew-coffee';
        if (String(cache.restaurantId || '').toLowerCase() !== rId) return false;
        if (!Array.isArray(cache.items) || cache.items.length === 0) return false;
        if (!Array.isArray(cache.categories)) return false;

        // Expiration check (7 days)
        if (cache.timestamp) {
            var age = Date.now() - Number(cache.timestamp);
            if (isNaN(age) || age < 0 || age > MAX_AGE_MS) return false;
        }

        // Discard any dummy test items or mock images
        if (cache.items.some(function (it) { return it && (it.id === 'item_1' || (it.image && it.image.indexOf('images.unsplash.com') !== -1)); })) return false;

        // Structural check: items must have valid IDs
        for (var i = 0; i < Math.min(cache.items.length, 30); i++) {
            var it = cache.items[i];
            if (!it || typeof it !== 'object' || it.id == null) return false;
        }

        return true;
    }

    function get(restaurantId) {
        var rId = String(restaurantId || '').trim().toLowerCase() || 'brew-coffee';
        var key = getStorageKey(rId);
        try {
            var raw = localStorage.getItem(key);
            if (!raw) {
                // Backward-compatibility: if rId is 'brew-coffee', migrate legacy generic cache
                if (rId === 'brew-coffee') {
                    var oldItemsRaw = localStorage.getItem('cachedMenuItems');
                    var oldCatsRaw = localStorage.getItem('cachedCategories');
                    if (oldItemsRaw) {
                        try {
                            var oldItems = JSON.parse(oldItemsRaw);
                            var oldCats = oldCatsRaw ? JSON.parse(oldCatsRaw) : [];
                            if (Array.isArray(oldItems) && oldItems.length > 0 && !oldItems.some(function (x) { return x && (x.id === 'item_1' || (x.image && x.image.indexOf('images.unsplash.com') !== -1)); })) {
                                var legacyCache = {
                                    restaurantId: 'brew-coffee',
                                    version: CURRENT_SCHEMA_VERSION,
                                    timestamp: Date.now(),
                                    categories: Array.isArray(oldCats) ? oldCats : [],
                                    items: oldItems
                                };
                                safeSetItem(key, JSON.stringify(legacyCache));
                                return legacyCache;
                            }
                        } catch (e) {}
                    }
                }
                return null;
            }
            var parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.items) && parsed.items.some(function (it) { return it && (it.id === 'item_1' || (it.image && it.image.indexOf('images.unsplash.com') !== -1)); })) {
                console.warn('[MenuCache] Purging dummy test items from cache for', rId);
                try { localStorage.removeItem(key); } catch (e) {}
                try { localStorage.removeItem('cachedMenuItems'); } catch (e) {}
                return null;
            }
            if (isValid(parsed, rId)) {
                return parsed;
            } else {
                console.warn('[MenuCache] Discarding invalid/expired cache for', rId);
                try { localStorage.removeItem(key); } catch (e) {}
                return null;
            }
        } catch (e) {
            console.error('[MenuCache] Failed parsing cache for', rId, e);
            try { localStorage.removeItem(key); } catch (err) {}
            return null;
        }
    }

    function set(restaurantId, items, categories) {
        var rId = String(restaurantId || '').trim().toLowerCase() || 'brew-coffee';
        if (!Array.isArray(items) || items.length === 0) return false;
        var existing = null;
        try {
            var raw = localStorage.getItem(getStorageKey(rId));
            if (raw) existing = JSON.parse(raw);
        } catch (e) {}

        var finalCategories = Array.isArray(categories) && categories.length > 0
            ? categories
            : (existing && Array.isArray(existing.categories) ? existing.categories : []);

        var payload = {
            restaurantId: rId,
            version: CURRENT_SCHEMA_VERSION,
            timestamp: Date.now(),
            categories: finalCategories,
            items: items
        };

        try {
            safeSetItem(getStorageKey(rId), JSON.stringify(payload));
            // Keep legacy keys updated for 'brew-coffee' for backward compatibility
            if (rId === 'brew-coffee') {
                safeSetItem('cachedMenuItems', JSON.stringify(items));
                if (finalCategories.length > 0) {
                    safeSetItem('cachedCategories', JSON.stringify(finalCategories));
                }
            }
            return true;
        } catch (e) {
            console.warn('[MenuCache] Save error for', rId, e);
            return false;
        }
    }

    function clear(restaurantId) {
        if (restaurantId) {
            try { localStorage.removeItem(getStorageKey(restaurantId)); } catch (e) {}
        }
    }

    return {
        getStorageKey: getStorageKey,
        isValid: isValid,
        get: get,
        set: set,
        clear: clear
    };
})();
window.MenuCache = MenuCache;

// Use local API instead of Firebase
var USE_LOCAL_API = false;
var API_BASE = 'api';

function localApiRequest(endpoint, options) {
    options = options || {};
    // Resolve the API URL absolutely (same logic as getApiUrl in local-api.js)
    // so requests work regardless of how the page is served. Falling back to a
    // relative URL only works when the document and the API share an origin.
    var url = (typeof getApiUrl === 'function') ? getApiUrl(endpoint) : (API_BASE + '/' + endpoint);
    var method = options.method || 'GET';
    var body = options.body || null;
    var headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    
    var config = {
        method: method,
        headers: headers,
        mode: 'cors',
        credentials: 'include'
    };
    
    if (body) {
        config.body = JSON.stringify(body);
    }
    
    return fetch(url, config).then(function(response) {
        if (!response.ok) {
            return response.json().then(function(err) {
                throw new Error(err.error || 'HTTP ' + response.status);
            }).catch(function() {
                throw new Error('HTTP ' + response.status);
            });
        }
        return response.json();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    try {
        var staleInstall = document.getElementById('installTutorialOverlay');
        if (staleInstall) staleInstall.remove();
        document.body.classList.remove('install-tutorial-open');

        const urlLang = new URLSearchParams(window.location.search).get('lang');
        var sessionLang = null;
        try { sessionLang = sessionStorage.getItem('selectedLang'); } catch (e) {}
        const savedLang = urlLang || sessionLang || 'ku';
        try { localStorage.setItem('selectedLang', savedLang); } catch (e) {}
        setActiveLanguage(savedLang);
        applyLanguageUI(savedLang);
        setupThemeToggle();
        setupOfflineDetection();

        if (document.getElementById('menuGrid')) {
            if (typeof initRestaurantSubscriptionSystem === 'function') {
                initRestaurantSubscriptionSystem();
            }
            if (typeof enforceMenuExpiry === 'function' && enforceMenuExpiry()) {
                // Still load settings so admin changes / live expire updates work.
                loadCafeSettingsFromFirestore(function () {
                    enforceMenuExpiry();
                    subscribeCafeSettingsUpdates();
                });
                return;
            }
            loadCafeSettingsFromFirestore(function () {
                updateCafeInfoPanel();
                subscribeCafeSettingsUpdates();
                if (typeof enforceMenuExpiry === 'function') enforceMenuExpiry();
            });
            initMenuOffersSlideshow();
            loadMenuItems();
            setupLanguageButtons();
            initHeroTitleSequence();
            setupInstallTutorial();
        } else if (document.getElementById('heroTypewriter')) {
            initHeroTitleSequence();
        }
    } catch (e) {
        console.error('Init error:', e);
    }
});

/* ========================================
   Customer Location (cart → WhatsApp)
   ======================================== */

window._customerLocationUrl = '';

function useCurrentLocation() {
    var statusEl = document.getElementById('cartLocationStatus');
    if (!statusEl) return;

    if (!navigator.geolocation) {
        statusEl.textContent = 'Geolocation is not supported by your browser. You can continue without it.';
        statusEl.className = 'cart-location-status error';
        statusEl.classList.remove('hidden');
        return;
    }

    statusEl.textContent = 'Getting your location...';
    statusEl.className = 'cart-location-status';
    statusEl.classList.remove('hidden');

    navigator.geolocation.getCurrentPosition(
        function (pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            window._customerLocationUrl = 'https://maps.google.com/?q=' + lat + ',' + lng;
            statusEl.textContent = 'Location captured ✓';
            statusEl.className = 'cart-location-status success';
        },
        function (err) {
            window._customerLocationUrl = '';
            var msg = 'Unable to get location. You can continue without it.';
            if (err.code === 1) msg = 'Location permission denied. You can continue without it.';
            statusEl.textContent = msg;
            statusEl.className = 'cart-location-status error';
            statusEl.classList.remove('hidden');
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
}

/* ========================================
   i18n
   ======================================== */

const i18n = {
    ku: {
        poweredBy: 'پشتگیری کراوە لەلایەن',
        menuTitle: 'مێنووی ئێمە',
        loadingMenu: 'داگرتنی مێنوو...',
        noItems: 'هیچ شتێک نییە لە مێنوودا.',
        noCategoryItems: 'هیچ شتێک نییە لەم بەشەدا.',
        errorLoadingMenu: 'هەڵە لە داگرتنی مێنوودا.',
        menuLoadRetry: 'دووبارە هەوڵبدەرەوە',
        menuConnectionHint: 'پەیوەندی ئینتەرنێت یان ڕێکخستنی Firebase بپشکنە.',
        noCategories: 'هیچ بەشێک نییە.',
        pageTitle: 'بریو کافێ | مێنوو',
        dashboard: 'داشبۆرد',
        manageItems: 'بەڕێوەبردنی ئایتمەکان',
        manageCategories: 'بەڕێوەبردنی بەشەکان',
        manageOffers: 'بەڕێوەبردنی ئۆفەرەکان',
        addOffer: 'زیادکردنی ئۆفەر',
        editOffer: 'دەستکاری ئۆفەر',
        saveOffer: 'پاشەکەوتکردنی ئۆفەر',
        offerImage: 'وێنەی ئۆفەر',
        offerTitle: 'ناونیشانی ئۆفەر (ئارەزوومەندانە)',
        offerLink: 'بەستەری ئۆفەر (ئارەزوومەندانە)',
        offerActive: 'چالاک لە مێنوو',
        offerOrder: 'ڕیزبەندی',
        noOffers: 'هیچ ئۆفەرێک نییە. وێنەی ئۆفەر زیاد بکە.',
        offerSavedCloud: 'ئۆفەر پاشەکەوت کرا.',
        offerDeleted: 'ئۆفەر سڕایەوە.',
        deleteOfferConfirm: 'دڵنیایت لە سڕینەوەی ئەم ئۆفەرە؟',
        offersHint: 'ئەم وێنانە لە سەرەوەی مێنوو دەردەکەون — هەر وێنەیەک ٣ چرکە.',
        reports: 'ڕاپۆرتەکان',
        cashier: 'کاشێر',
        manageReviews: 'هەڵسەنگاندنەکان',
        manageTestMenu: 'مینیوی تاقیکاری',
        manageSubscription: 'بەشداری و مۆڵەت (SmartServe)',
        superAdmin: 'سوپەر ئەدمین (SmartServe)',
        customerReviewsTitle: 'ڕا و بەهای کڕیار',
        customerReviewsSubtitle: 'سەرنج و بۆچوونی بەڕێزتان ئاستی خزمەتگوزاریمان بەرز دەکاتەوە',
        reviewAspectLabel: 'بابەتی هەڵسەنگاندنەکە:',
        aspectOverall: 'گشتی',
        aspectDrinks: 'خواردنەوەکان',
        aspectFoods: 'خواردنەکان',
        aspectService: 'خزمەتگوزاری',
        aspectDecor: 'کەشوهەوا و دیزاین',
        reviewRatingLabel: 'ئاستی ڕازیبوون:',
        reviewNamePlaceholder: 'ناوت (ئارەزوومەندانە):',
        reviewTablePlaceholder: 'ژمارەی مێز یان تەلەفۆن:',
        reviewCommentLabel: 'ڕا و پێشنیازەکەت:',
        submitReviewBtn: 'ناردنی هەڵسەنگاندن • Submit Review',
        reviewSuccessTitle: 'زۆر سوپاس بۆ ڕا و بەهایەکەت! ❤️',
        reviewSuccessMsg: 'پێشنیاز و سەرنجەکەت بە سەرکەوتوویی گەیشتە بەڕێوەبەرایەتی. دەنگی تۆ باشترین پاڵنەرمانە.',
        reviewAgainBtn: 'ناردنی هەڵسەنگاندنێکی تر',
        recentGuestReviews: 'ڕاکانی کڕیارانی تر',
        settings: 'ڕێکخستنەکان',
        logout: 'دەرچوون',
        viewMenu: 'بینینی مێنوو',
        admin: 'بەڕێوەبەر',
        ku: 'کوردی',
        ar: 'عەرەبی',
        en: 'ئینگلیزی',
        coffee: 'قاوە',
        tea: 'چای',
        dessert: 'شیرینی',
        coldDrinks: 'خواردنەوەی سارد',
        shisha: 'نێرگیلە',
        specialDrinks: 'خواردنەوەی تایبەت',
        viewDetails: 'بینینی زیاتر',
        todaySales: 'فرۆشتنی ئەمڕۆ',
        todayOrders: 'داواکارییەکانی ئەمڕۆ',
        monthlySales: 'فرۆشتنی ئەم مانگە',
        totalOrders: 'کۆی هەموو داواکارییەکان',
        bestSelling: 'باشترین فرۆشراو',
        selectMonth: 'مانگ هەڵبژێرە',
        dailySales: 'فرۆشتنی ڕۆژانە',
        noSalesData: 'هیچ داتای فرۆشتن نییە',
        january: 'کانوونی دووەم',
        february: 'شوبات',
        march: 'ئازار',
        april: 'نیسان',
        may: 'ئایار',
        june: 'حوزەیران',
        july: 'تەمووز',
        august: 'ئاب',
        september: 'ئەیلوول',
        october: 'تشرینی یەکەم',
        november: 'تشرینی دووەم',
        december: 'کانونی یەکەم',
        week: 'هەفتە',
        totalSales: 'کۆی هەموو فرۆشتن',
        weeklySales: 'فرۆشتنی ئەم هەفتەیە',
        recentSales: 'نوێترین فرۆشتنەکان',
        time: 'کات',
        items: 'ئایتم',
        total: 'کۆی گشتی',
        noSalesYet: 'هیچ فرۆشتنێک نییە تا ئێستا',
        noSalesData: 'هیچ داتایەکی فرۆشتن بەردەست نییە',
        addNewItem: '+ زیادکردنی ئایتمی نوێ',
        searchItems: 'گەڕان بۆ ئایتم...',
        searchPlaceholder: 'گەڕان لە مێنوو...',
        noResults: 'هیچ ئایتمێک نەدۆزرایەوە',
        allCategories: 'هەموو بەشەکان',
        allItems: 'هەموو',
        all: 'هەموو',
        select: 'هەڵبژێرە',
        kurdishName: 'ناو بە کوردی',
        arabicName: 'ناو بە عەرەبی',
        englishName: 'ناو بە ئینگلیزی',
        kurdishDesc: 'وەسف بە کوردی',
        arabicDesc: 'وەسف بە عەرەبی',
        englishDesc: 'وەسف بە ئینگلیزی',
        imageURL: 'بەستەری وێنە',
        price: 'نرخ (IQD)',
        category: 'بەش',
        available: 'بەردەستە',
        notAvailable: 'بەردەست نییە',
        saveItem: 'پاشەکەوتکردن',
        cancel: 'پاشگەزبوونەوە',
        edit: 'دەستکاری',
        delete: 'سڕینەوە',
        deleteConfirm: 'دڵنیایت لە سڕینەوەی ئەم ئایتمە؟',
        fillAll: 'تکایە هەموو خانەکان پڕ بکەرەوە',
        selectCategory: 'تکایە بەشێک هەڵبژێرە (Category)',
        itemSaved: 'ئایتم پاشەکەوت کرا!',
        itemSavedCloud: 'پاشەکەوت کرا — مێنوو بۆ هەموو کڕیارەکان نوێکرایەوە!',
        itemSavedOffline: 'لە مۆبایل پاشەکەوت کرا — کاتێک ئینتەرنێت هەبوو بۆ مێنوو دەچێت.',
        itemSyncFailed: 'نەتوانرا بۆ ئینتەرنێت بنێردرێت. ئینتەرنێت بپشکنە و دووبارە هەوڵبدەرەوە.',
        connectionSlow: 'پەیوەندی خاوە — دووبارە هەوڵبدەرەوە.',
        itemError: 'هەڵە: ',
        categoriesList: 'بەشەکانی سیستەم:',
        noItemsFound: 'هیچ ئایتمێک نەدۆزرایەوە',
        weeklySales: 'فرۆشتنی ئەم هەفتەیە',
        totalSales: 'کۆی گشتی فرۆشتن',
        currentOrder: 'داواکاریی ئێستا',
        clear: 'خاوێنکردنەوە',
        payNow: '💳 پارەدان',
        addFirst: 'تکایە سەرەتا ئایتم زیاد بکە',
        paymentSuccess: 'پارەدان سەرکەوتوو بوو! کۆی گشتی: ',
        noItemsAdded: 'هیچ ئایتمێک زیاد نەکراوە.\nکلیک لەسەر ئایتم بکە بۆ زیادکردن.',
        cafeName: 'ناوی کافێ',
        locationMapsUrl: 'لینکی نەخشە (Google Maps)',
        locationLabelField: 'ناونیشان (دەردەکەوێت لە مێنوو)',
        cafeOpenTimeLabel: 'کاتی کردنەوە',
        cafeCloseTimeLabel: 'کاتی داخراو',
        menuExpireDateLabel: 'بەرواری بەسەرچوونی مێنوو',
        menuExpireDateHint: 'بەتاڵ جێبهێڵە = هەرگیز بەسەر ناچێت. بۆ تاقیکردنەوە: menu.html?expired=1',
        menuExpirePreview: 'پیشاندانی شاشەی بەسەرچوو',
        cafeOpenTimePlaceholder: '٢:٠٠ دوای نیوەڕۆ',
        cafeCloseTimePlaceholder: '٢:٠٠ بەیانی',
        timeAm: 'بەیانی',
        timePm: 'شەو',
        applyTime: 'جێبەجێکردن',
        saveHours: 'پاشەکەوتکردنی کاتەکان',
        hoursSaved: 'کاتەکان پاشەکەوت کران!',
        cafeHoursDaily: 'ڕۆژانە',
        callWhatsAppNumber: 'ژمارەی پەیوەندی / واتساپ',
        currency: 'دراو',
        saveSettings: 'پاشەکەوتکردن',
        settingsSaved: 'ڕێکخستنەکان پاشەکەوت کران!',
        yes: 'بەڵێ',
        no: 'نەخێر',
        sectionNotFound: 'بەش نەدۆزرایەوە',
        errorLoading: 'هەڵە لە بارکردن: ',
        loading: 'بارکردن...',
        errorLoadingSection: 'هەڵە لە بارکردنی بەش ',
        errorPrefix: 'هەڵە: ',
        unnamed: 'بێ ناو',
        editItem: 'دەستکاری ئایتم',
        editExpense: 'دەستکاری خەرجی',
        addNewItem: '+ زیادکردنی ئایتمی نوێ',
        sold: 'دانە',
        itemsCount: ' ئایتم',
        unknown: 'نەناسراو',
        siteName: 'بریو کافێ',
        addCategory: '+ زیادکردنی بەشی نوێ',
        categoryNameKu: 'ناوی بەش بە کوردی',
        categoryNameAr: 'ناوی بەش بە عەرەبی',
        categoryNameEn: 'ناوی بەش بە ئینگلیزی',
        categoryImage: 'بەستەری وێنەی بەش',
        saveCategory: 'پاشەکەوتکردنی بەش',
        editCategory: 'دەستکاری بەش',
        deleteCategory: 'سڕینەوەی بەش',
        deleteCategoryConfirm: 'دڵنیایت لە سڕینەوەی ئەم بەشە؟ هەموو ئایتمەکانی ئەم بەشە دەسڕێنەوە.',
        categorySaved: 'بەش پاشەکەوت کرا!',
        categorySavedCloud: 'بەش پاشەکەوت کرا — مێنوو نوێکرایەوە!',
        categorySavedOffline: 'بەش لە مۆبایل پاشەکەوت کرا — دواتر بۆ مێنوو دەچێت.',
        categoryError: 'هەڵە لە بەش: ',
        createNewCategory: '+ دروستکردنی بەشی نوێ',
        likeItem: 'پەسەندکردن',
        unlikeItem: 'لابردنی پەسەندکردن',
        printReceipt: 'چاپ',
        offlineMode: 'بێ هێڵ — گۆڕانکارییەکان دەهێنرێنە ڕێک',
        backOnline: 'گەڕایەوە سەرهێڵ — ڕێکخستن',
        resetAllData: 'سڕینەوەی هەموو داتاکان',
        resetConfirm: 'دڵنیایت لە سڕینەوەی هەموو داتاکان؟ ئەم کارە ناتوانرێت بگەرێتەوە !',
        resetSuccess: 'هەموو داتاکان سڕانەوە!',
        resetError: 'هەڵە لە سڕینەوە: ',
        expenses: 'خەرجیەکان',
        addExpense: '+ زیادکردنی خەرجی',
        expenseName: 'ناوی خەرجی',
        expensePrice: 'نرخ (IQD)',
        expenseDate: 'بەروار',
        expenseTime: 'کات',
        expenseSaved: 'خەرجی پاشەکەوت کرا!',
        expenseSavedOffline: 'خەرجی لەسەر ئامێرەکەت پاشەکەوت کرا — کاتێک ئینتەرنێت هات، خۆکار دەنێردرێت.',
        expenseError: 'هەڵە لە خەرجی: ',
        expenseDeleted: 'خەرجی سڕایەوە!',
        expenseDeletedOffline: 'خەرجی لەسەر ئامێرەکەت سڕایەوە.',
        totalExpenses: 'کۆی خەرجیەکان',
        todayExpenses: 'خەرجیەکانی ئەمڕۆ',
        monthlyExpenses: 'خەرجیەکانی ئەم مانگە',
        netIncome: 'داتای خاو',
        noExpenses: 'هیچ خەرجیەک نییە',
        deleteExpenseConfirm: 'دڵنیایت لە سڕینەوەی ئەم خەرجیە؟',
        water: 'ئاو',
        milk: 'شیر',
        coffee: 'قاوە',
        electric: 'کارەبا',
        gas: 'گاز',
        rent: 'کرێ',
        salary: 'مووچە',
        other: 'هیتر',
        cart: 'سەبەتە',
        addToCart: '+ زیادکردن بۆ سەبەتە',
        remove: 'لابردن',
        cartEmpty: 'سەبەتە بەتاڵە',
        favorites: 'دڵخوازەکان',
        favoritesEmpty: 'دڵخوازەکانت بەتاڵە',
        addToFavorites: 'زیادکردن بۆ دڵخوازەکان',
        removeFromFavorites: 'لابردن لە دڵخوازەکان',
        addAllToCart: 'هەمووی زیادبکە بۆ سەبەتە',
        clearAll: 'سڕینەوە',
        cartTotal: 'کۆی گشتی',
        sendWhatsApp: 'ناردن بە واتساپ',
        useCurrentLocation: '📍ناردن لینکی لۆکەیشن',
        needLocation: 'تکایە لۆکەیشنەکەت بنێرە پێش ناردن بە واتساپ',
        whatsappPhone: 'ژمارەی واتساپ',
        phonePlaceholder: '٩٦٤٧٧٠١٢٣٤٥٦٧',
        orderSent: 'داواکاری نێردرا!',
        quantity: 'ژمارە',
        themeWhite: 'سپی',
        themeCream: 'زێڕی کاڵ',
        themePearl: 'زێڕی کاڵ',
        themeCoffee: 'قاوە',
        themeGold: 'زێڕین',
        themeRed: 'سور',
        themeMocha: 'موکا',
        themeCopper: 'مس',
        themeOcean: 'مس',
        themeOlive: 'زەیتوون',
        themeDark: 'تاریک',
        cafeOpen: 'ئێستا کراوەیە',
        cafeClosed: 'ئێستا داخراوە',
        cafeContact: 'پەیوەندی',
        cafeCall: 'پەیوەندی',
        cafeWhatsapp: 'واتساپ',
        cafeShare: 'هاوبەشکردن',
        cafeLocation: 'شوێن',
        cafeHours: 'کاتی کردنەوە',
        cafeHoursValue: 'ڕۆژانە: ٢:٠٠ دوای نیوەڕۆ — ٢:٠٠ بەیانی',
        cafeFollowUs: 'فۆڵۆومان بکەن',
        socialLinks: 'لینکەکانی سۆشیاڵ میدیا',
        socialLinksHint: 'لینکی ئینستاگرام، تیکتۆک و سنەپچات — لە بەشی «فۆڵۆومان بکەن» دەردەکەون',
        instagramUrl: 'ئینستاگرام',
        tiktokUrl: 'تیکتۆک',
        snapchatUrl: 'سنەپچات',
        facebookUrl: 'فەيسبۆک',
        cafeFacebook: 'فەيسبۆک',
        cafeInfoTitle: 'بریو کافێ',
        linkCopied: 'بەستەر کۆپی کرا!',
        installTitle: 'زیادکردن بۆ سکرینی سەرەکی',
        installSubtitle: 'زیادکردنی مینیۆ کەمان بوو ناو سکرین وەکو ئەپلیکەیشن',
        installIos: 'iPhone (iOS)',
        installAndroid: 'Android',
        installGotIt: 'تێگەیشتم',
        installDontShow: 'دووبارە پیشان مەدە',
        installShowHelp: 'زیادکردن بۆ سکرینی سەرەکی',
        installNow: 'ئێستا دابمەزرێنە',
    },
    ar: {
        poweredBy: 'التطوير بواسطة',
        menuTitle: 'قائمتنا',
        loadingMenu: 'جارٍ تحميل القائمة...',
        noItems: 'لا توجد عناصر في القائمة.',
        noCategoryItems: 'لا توجد عناصر في هذا القسم.',
        errorLoadingMenu: 'حدث خطأ أثناء تحميل القائمة.',
        menuLoadRetry: 'إعادة المحاولة',
        menuConnectionHint: 'تحقق من الإنترنت أو إعدادات Firebase.',
        noCategories: 'لا توجد أقسام.',
        pageTitle: 'بریو کوفي | القائمة',
        dashboard: 'لوحة التحكم',
        manageItems: 'إدارة العناصر',
        manageCategories: 'إدارة الفئات',
        manageOffers: 'إدارة العروض',
        addOffer: 'إضافة عرض',
        editOffer: 'تعديل العرض',
        saveOffer: 'حفظ العرض',
        offerImage: 'صورة العرض',
        offerTitle: 'عنوان العرض (اختياري)',
        offerLink: 'رابط العرض (اختياري)',
        offerActive: 'نشط في القائمة',
        offerOrder: 'الترتيب',
        noOffers: 'لا توجد عروض. أضف صور العروض.',
        offerSavedCloud: 'تم حفظ العرض.',
        offerDeleted: 'تم حذف العرض.',
        deleteOfferConfirm: 'هل أنت متأكد من حذف هذا العرض؟',
        offersHint: 'تظهر هذه الصور أعلى القائمة — كل صورة لمدة ٣ ثوانٍ.',
        reports: 'التقارير',
        cashier: 'الصندوق',
        manageReviews: 'التقييمات والآراء',
        manageTestMenu: 'موك التجربة (Test Menu)',
        manageSubscription: 'الاشتراك والترخيص (SmartServe)',
        superAdmin: 'سوبر أدمن (SmartServe)',
        customerReviewsTitle: 'آراء وانطباعات الضيوف',
        customerReviewsSubtitle: 'رأيك يهمنا للارتقاء بأعلى معايير الجودة والضيافة',
        reviewAspectLabel: 'موضوع التقييم:',
        aspectOverall: 'عام',
        aspectDrinks: 'المشروبات',
        aspectFoods: 'المأكولات',
        aspectService: 'الخدمة والضيافة',
        aspectDecor: 'الأجواء والتصميم',
        reviewRatingLabel: 'مستوى الرضا:',
        reviewNamePlaceholder: 'الاسم (اختياري):',
        reviewTablePlaceholder: 'رقم الطاولة أو الهاتف:',
        reviewCommentLabel: 'رأيك وملاحظاتك:',
        submitReviewBtn: 'إرسال التقييم • Submit Review',
        reviewSuccessTitle: 'شكراً جزيلاً لرأيك وتجربتك! ❤️',
        reviewSuccessMsg: 'تم استلام ملاحظاتك بنجاح ووصلت مباشرة للإدارة لتحسين خدماتنا.',
        reviewAgainBtn: 'إرسال تقييم آخر',
        recentGuestReviews: 'آراء وانطباعات الضيوف',
        settings: 'الإعدادات',
        logout: 'تسجيل الخروج',
        viewMenu: 'عرض القائمة',
        admin: 'المشرف',
        ku: 'كوردي',
        ar: 'عربي',
        en: 'English',
        coffee: 'قهوة',
        tea: 'شاي',
        dessert: 'حلوى',
        coldDrinks: 'مشروبات باردة',
        shisha: 'نرگیلة',
        specialDrinks: 'مشروبات خاصة',
        viewDetails: 'عرض التفاصيل',
        todaySales: 'مبيعات اليوم',
        todayOrders: 'طلبات اليوم',
        monthlySales: 'مبيعات الشهر',
        totalOrders: 'إجمالي الطلبات',
        bestSelling: 'الأكثر مبيعاً',
        selectMonth: 'اختر الشهر',
        dailySales: 'المبيعات اليومية',
        noSalesData: 'لا توجد بيانات مبيعات',
        january: 'كانون الثاني',
        february: 'شباط',
        march: 'آذار',
        april: 'نيسان',
        may: 'آيار',
        june: 'حزيران',
        july: 'تموز',
        august: 'آب',
        september: 'أيلول',
        october: 'تشرين الأول',
        november: 'تشرين الثاني',
        december: 'كانون الأول',
        week: 'أسبوع',
        totalSales: 'إجمالي المبيعات',
        weeklySales: 'مبيعات الأسبوع',
        recentSales: 'المبيعات الأخيرة',
        time: 'الوقت',
        items: 'عناصر',
        total: 'الإجمالي',
        noSalesYet: 'لا توجد مبيعات بعد',
        noSalesData: 'لا توجد بيانات مبيعات',
        addNewItem: '+ إضافة عنصر جديد',
        searchItems: 'البحث عن عناصر...',
        searchPlaceholder: 'ابحث في القائمة...',
        noResults: 'لا توجد نتائج',
        allCategories: 'جميع الفئات',
        allItems: 'الكل',
        all: 'الكل',
        select: 'اختر',
        kurdishName: 'الاسم الكردي',
        arabicName: 'الاسم العربي',
        englishName: 'الاسم الإنجليزي',
        kurdishDesc: 'الوصف الكردي',
        arabicDesc: 'الوصف العربي',
        englishDesc: 'الوصف الإنجليزي',
        imageURL: 'رابط الصورة',
        price: 'السعر (IQD)',
        category: 'الفئة',
        available: 'متاح',
        notAvailable: 'غير متاح',
        saveItem: 'حفظ',
        cancel: 'إلغاء',
        edit: 'تعديل',
        delete: 'حذف',
        deleteConfirm: 'هل أنت متأكد من حذف هذا العنصر؟',
        fillAll: 'يرجى ملء جميع الحقول المطلوبة',
        selectCategory: 'يرجى اختيار القسم (Category)',
        itemSaved: 'تم حفظ العنصر!',
        itemSavedCloud: 'تم الحفظ — تم تحديث القائمة لجميع الزبائن!',
        itemSavedOffline: 'حُفظ على الهاتف — سيظهر في القائمة عند الاتصال بالإنترنت.',
        itemSyncFailed: 'تعذر المزامنة مع السحابة. تحقق من الإنترنت وحاول مرة أخرى.',
        connectionSlow: 'الاتصال بطيء — حاول مرة أخرى.',
        itemError: 'خطأ: ',
        categoriesList: 'فئات النظام:',
        noItemsFound: 'لم يتم العثور على عناصر',
        weeklySales: 'مبيعات الأسبوع',
        totalSales: 'إجمالي المبيعات',
        currentOrder: 'الطلب الحالي',
        clear: 'مسح',
        payNow: '💳 ادفع الآن',
        addFirst: 'يرجى إضافة عناصر أولاً',
        paymentSuccess: 'تم الدفع بنجاح! الإجمالي: ',
        noItemsAdded: 'لم تتم إضافة أي عناصر.\nاضغط على العناصر لإضافتها.',
        cafeName: 'اسم المقهى',
        locationMapsUrl: 'رابط الخريطة (Google Maps)',
        locationLabelField: 'العنوان (يظهر في القائمة)',
        cafeOpenTimeLabel: 'وقت الفتح',
        cafeCloseTimeLabel: 'وقت الإغلاق',
        menuExpireDateLabel: 'تاريخ انتهاء القائمة',
        menuExpireDateHint: 'اتركه فارغًا = لا ينتهي أبدًا. للاختبار: menu.html?expired=1',
        menuExpirePreview: 'معاينة شاشة الانتهاء',
        cafeOpenTimePlaceholder: '٢:٠٠ مساءً',
        cafeCloseTimePlaceholder: '٢:٠٠ صباحاً',
        timeAm: 'صباحاً',
        timePm: 'مساءً',
        applyTime: 'تطبيق',
        saveHours: 'حفظ الأوقات',
        hoursSaved: 'تم حفظ الأوقات!',
        cafeHoursDaily: 'يومياً',
        callWhatsAppNumber: 'رقم الاتصال / واتساب',
        currency: 'العملة',
        saveSettings: 'حفظ الإعدادات',
        settingsSaved: 'تم حفظ الإعدادات!',
        yes: 'نعم',
        no: 'لا',
        sectionNotFound: 'القسم غير موجود',
        errorLoading: 'خطأ في التحميل: ',
        loading: 'جارٍ التحميل...',
        errorLoadingSection: 'خطأ في تحميل القسم ',
        errorPrefix: 'خطأ: ',
        unnamed: 'بلا اسم',
        editItem: 'تعديل العنصر',
        editExpense: 'تعديل المصروف',
        addNewItem: '+ إضافة عنصر جديد',
        sold: 'قطعة',
        itemsCount: ' عناصر',
        unknown: 'غير معروف',
        siteName: 'بریو کوفي',
        addCategory: '+ إضافة فئة جديدة',
        categoryNameKu: 'اسم الفئة بالكردية',
        categoryNameAr: 'اسم الفئة بالعربية',
        categoryNameEn: 'اسم الفئة بالإنجليزية',
        categoryImage: 'رابط صورة الفئة',
        saveCategory: 'حفظ الفئة',
        editCategory: 'تعديل الفئة',
        deleteCategory: 'حذف الفئة',
        deleteCategoryConfirm: 'هل أنت متأكد من حذف هذه الفئة؟ سيتم حذف جميع العناصر في هذه الفئة.',
        categorySaved: 'تم حفظ الفئة!',
        categorySavedCloud: 'تم حفظ الفئة — تم تحديث القائمة!',
        categorySavedOffline: 'حُفظت الفئة على الهاتف — ستُزامَن لاحقاً.',
        categoryError: 'خطأ في الفئة: ',
        createNewCategory: '+ إنشاء فئة جديدة',
        likeItem: 'إعجاب',
        unlikeItem: 'إلغاء الإعجاب',
        printReceipt: 'طباعة',
        offlineMode: 'بدون إنترنت — ستتم المزامنة',
        backOnline: 'عاد الاتصال — تتم المزامنة',
        resetAllData: 'حذف جميع البيانات',
        resetConfirm: 'هل أنت متأكد من حذف جميع البيانات؟ لا يمكن التراجع عن هذا!',
        resetSuccess: 'تم حذف جميع البيانات!',
        resetError: 'خطأ في الحذف: ',
        expenses: 'المصروفات',
        addExpense: '+ إضافة مصروف',
        expenseName: 'اسم المصروف',
        expensePrice: 'السعر (IQD)',
        expenseDate: 'التاريخ',
        expenseTime: 'الوقت',
        expenseSaved: 'تم حفظ المصروف!',
        expenseSavedOffline: 'تم حفظ المصروف على جهازك — سيُزامَن تلقائياً عند عودة الإنترنت.',
        expenseError: 'خطأ في المصروف: ',
        expenseDeleted: 'تم حذف المصروف!',
        expenseDeletedOffline: 'تم حذف المصروف من جهازك.',
        totalExpenses: 'إجمالي المصروفات',
        todayExpenses: 'مصروفات اليوم',
        monthlyExpenses: 'مصروفات الشهر',
        netIncome: 'الدخل الصافي',
        noExpenses: 'لا توجد مصروفات',
        deleteExpenseConfirm: 'هل أنت متأكد من حذف هذا المصروف؟',
        water: 'ماء',
        milk: 'حليب',
        coffee: 'قهوة',
        electric: 'كهرباء',
        gas: 'غاز',
        rent: 'إيجار',
        salary: 'راتب',
        other: 'أخرى',
        cart: 'السلة',
        addToCart: '+ إضافة للسلة',
        remove: 'إزالة',
        cartEmpty: 'السلة فارغة',
        favorites: 'المفضلة',
        favoritesEmpty: 'قائمتك المفضلة فارغة',
        addToFavorites: 'إضافة إلى المفضلة',
        removeFromFavorites: 'إزالة من المفضلة',
        addAllToCart: 'إضافة الكل للسلة',
        clearAll: 'مسح الكل',
        cartTotal: 'الإجمالي',
        sendWhatsApp: 'إرسال واتساب',
        useCurrentLocation: '📍 إرسال رابط الموقع',
        needLocation: 'الرجاء إرسال موقعك قبل الإرسال عبر واتساب',
        whatsappPhone: 'رقم واتساب',
        phonePlaceholder: '٩٦٤٧٧٠١٢٣٤٥٦٧',
        orderSent: 'تم إرسال الطلب!',
        quantity: 'الكمية',
        themeWhite: 'أبيض',
        themeCream: 'ذهبي فاتح',
        themePearl: 'ذهبي فاتح',
        themeCoffee: 'قهوة',
        themeGold: 'ذهبي',
        themeRed: 'أحمر',
        themeMocha: 'موكا',
        themeCopper: 'نحاسي',
        themeOcean: 'نحاسي',
        themeOlive: 'زيتوني',
        themeDark: 'داكن',
        cafeOpen: 'مفتوح الآن',
        cafeClosed: 'مغلق الآن',
        cafeContact: 'تواصل',
        cafeCall: 'اتصال',
        cafeWhatsapp: 'واتساب',
        cafeShare: 'مشاركة',
        cafeLocation: 'الموقع',
        cafeHours: 'ساعات العمل',
        cafeHoursValue: 'يومياً: ٢:٠٠ مساءً — ٢:٠٠ صباحاً',
        cafeFollowUs: 'تابعنا',
        socialLinks: 'روابط التواصل',
        socialLinksHint: 'روابط إنستغرام وتيك توك وسناب شات وفيسبوك — تظهر في «تابعنا»',
        instagramUrl: 'إنستغرام',
        tiktokUrl: 'تيك توك',
        snapchatUrl: 'سناب شات',
        facebookUrl: 'فيسبوك',
        cafeInfoTitle: 'بریو کوفي',
        linkCopied: 'تم نسخ الرابط!',
        installTitle: 'إضافة إلى الشاشة الرئيسية',
        installSubtitle: 'أضف قائمتنا إلى الشاشة الرئيسية كتطبيق',
        installIos: 'iPhone (iOS)',
        installAndroid: 'Android',
        installGotIt: 'فهمت',
        installDontShow: 'لا تظهر مرة أخرى',
        installShowHelp: 'إضافة للشاشة الرئيسية',
        installNow: 'تثبيت الآن',
        androidStep4: 'اضغط «Install» — يُثبت تطبيق بریو کوفي',
    },
    en: {
        poweredBy: 'Powered by',
        menuTitle: 'Our Menu',
        loadingMenu: 'Loading menu items...',
        noItems: 'No menu items found.',
        noCategoryItems: 'No items in this category.',
        errorLoadingMenu: 'Error loading menu.',
        menuLoadRetry: 'Try again',
        menuConnectionHint: 'Check internet or Firebase settings for this domain.',
        noCategories: 'No categories.',
        pageTitle: 'BREW CAFE & REST | Menu',
        dashboard: 'Dashboard',
        manageItems: 'Manage Items',
        manageCategories: 'Manage Categories',
        manageOffers: 'Manage Offers',
        addOffer: 'Add Offer',
        editOffer: 'Edit Offer',
        saveOffer: 'Save Offer',
        offerImage: 'Offer image',
        offerTitle: 'Offer title (optional)',
        offerLink: 'Offer link (optional)',
        offerActive: 'Active on menu',
        offerOrder: 'Order',
        noOffers: 'No offers yet. Add offer images.',
        offerSavedCloud: 'Offer saved.',
        offerDeleted: 'Offer deleted.',
        deleteOfferConfirm: 'Delete this offer image?',
        offersHint: 'These images show at the top of the menu — each image for 3 seconds.',
        reports: 'Reports',
        cashier: 'Cashier',
        manageReviews: 'Customer Reviews',
        manageTestMenu: 'Test Menu Suite',
        manageSubscription: 'Subscription & License (SmartServe)',
        superAdmin: 'Super Admin (SmartServe)',
        customerReviewsTitle: 'Guest Reviews & Feedback',
        customerReviewsSubtitle: 'Your impressions inspire our culinary craft and hospitality',
        reviewAspectLabel: 'Review Category:',
        aspectOverall: 'Overall',
        aspectDrinks: 'Drinks',
        aspectFoods: 'Foods',
        aspectService: 'Service',
        aspectDecor: 'Decor & Vibe',
        reviewRatingLabel: 'Your Rating:',
        reviewNamePlaceholder: 'Your Name (Optional):',
        reviewTablePlaceholder: 'Table # or Phone:',
        reviewCommentLabel: 'Your Impressions & Thoughts:',
        submitReviewBtn: 'Submit Review',
        reviewSuccessTitle: 'Thank You For Your Feedback! ❤️',
        reviewSuccessMsg: 'Your review has reached the management team directly. Thank you for helping us excel!',
        reviewAgainBtn: 'Submit Another Review',
        recentGuestReviews: 'Recent Guest Reviews',
        settings: 'Settings',
        logout: 'Logout',
        viewMenu: 'View Menu',
        admin: 'Admin',
        ku: 'Kurdish',
        ar: 'Arabic',
        en: 'English',
        coffee: 'Coffee',
        tea: 'Tea',
        dessert: 'Dessert',
        coldDrinks: 'Cold Drinks',
        shisha: 'Shisha',
        specialDrinks: 'Special Drinks',
        viewDetails: 'View',
        todaySales: 'Today Sales',
        todayOrders: "Today's Orders",
        monthlySales: 'Monthly Sales',
        totalOrders: 'Total Orders',
        bestSelling: 'Best Selling',
        selectMonth: 'Select Month',
        dailySales: 'Daily Sales',
        noSalesData: 'No sales data',
        january: 'January',
        february: 'February',
        march: 'March',
        april: 'April',
        may: 'May',
        june: 'June',
        july: 'July',
        august: 'August',
        september: 'September',
        october: 'October',
        november: 'November',
        december: 'December',
        week: 'Week',
        totalSales: 'Total Sales',
        weeklySales: 'Weekly Sales',
        recentSales: 'Recent Sales',
        time: 'Time',
        items: 'Items',
        total: 'Total',
        noSalesYet: 'No sales yet',
        noSalesData: 'No sales data',
        addNewItem: '+ Add New Item',
        searchItems: 'Search items...',
        searchPlaceholder: 'Search menu...',
        noResults: 'No items found',
        allCategories: 'All Categories',
        allItems: 'All',
        all: 'All',
        select: 'Select',
        kurdishName: 'Kurdish Name',
        arabicName: 'Arabic Name',
        englishName: 'English Name',
        kurdishDesc: 'Kurdish Description',
        arabicDesc: 'Arabic Description',
        englishDesc: 'English Description',
        imageURL: 'Image URL',
        price: 'Price (IQD)',
        category: 'Category',
        group: 'Group',
        groupKu: ' Kurdish',
        groupAr: 'Arabic',
        groupEn: 'English',
        available: 'Available',
        notAvailable: 'Not available',
        saveItem: 'Save Item',
        cancel: 'Cancel',
        edit: 'Edit',
        delete: 'Delete',
        deleteConfirm: 'Are you sure you want to delete this item?',
        fillAll: 'Please fill in all required fields',
        selectCategory: 'Please select a category',
        itemSaved: 'Item saved!',
        itemSavedCloud: 'Saved — menu updated for all customers!',
        itemSavedOffline: 'Saved on this phone — will sync to menu when online.',
        itemSyncFailed: 'Could not sync to cloud. Check internet and try again.',
        connectionSlow: 'Connection slow — try again.',
        itemError: 'Error: ',
        categoriesList: 'System categories:',
        noItemsFound: 'No items found',
        weeklySales: 'Weekly Sales',
        totalSales: 'Total Sales',
        currentOrder: 'Current Order',
        clear: 'Clear',
        payNow: '💳 Pay Now',
        addFirst: 'Please add items first',
        paymentSuccess: 'Payment successful! Total: ',
        noItemsAdded: 'No items added yet.\nTap items to add them.',
        cafeName: 'Cafe Name',
        locationMapsUrl: 'Map link (Google Maps)',
        locationLabelField: 'Address label (shown on menu)',
        cafeOpenTimeLabel: 'Opening time',
        cafeCloseTimeLabel: 'Closing time',
        menuExpireDateLabel: 'Menu expire date',
        menuExpireDateHint: 'Leave empty = never expires. To preview: menu.html?expired=1',
        menuExpirePreview: 'Preview expired screen',
        cafeOpenTimePlaceholder: '2:00 PM',
        cafeCloseTimePlaceholder: '2:00 AM',
        timeAm: 'AM',
        timePm: 'PM',
        applyTime: 'Apply',
        saveHours: 'Save hours',
        hoursSaved: 'Hours saved!',
        cafeHoursDaily: 'Daily',
        callWhatsAppNumber: 'Call / WhatsApp number',
        currency: 'Currency',
        saveSettings: 'Save Settings',
        settingsSaved: 'Settings saved!',
        yes: 'Yes',
        no: 'No',
        sectionNotFound: 'Section not found',
        errorLoading: 'Error loading: ',
        noSearchResults: 'No items found for',
        favorites: 'Favorites',
        favoritesEmpty: 'No favorites yet',
        addToFavorites: 'Add to favorites',
        removeFromFavorites: 'Remove from favorites',
        addAllToCart: 'Add All to Cart',
        clearAll: 'Clear All',
        rated: 'Rated',
        stars: 'stars',
        itemAddedToCart: 'Added to cart',
        viewCart: 'View Cart',
        cart: 'Cart',
        cartEmpty: 'Cart is empty',
        quantity: 'Qty',
        checkout: 'Checkout',
        orderPlaced: 'Order placed successfully! Total: ',
        orderError: 'Error placing order: ',
        loading: 'Loading...',
        errorLoadingSection: 'Error loading section ',
        errorPrefix: 'Error: ',
        sectionNotFound: 'Section not found',
        unnamed: 'Unnamed',
        editItem: 'Edit Item',
        editExpense: 'Edit Expense',
        addNewItem: 'Add New Item',
        sold: 'sold',
        itemsCount: ' items',
        unknown: 'unknown',
        siteName: 'BREW CAFE & REST',
        addCategory: '+ Add New Category',
        categoryNameKu: 'Category Name (Kurdish)',
        categoryNameAr: 'Category Name (Arabic)',
        categoryNameEn: 'Category Name (English)',
        categoryImage: 'Category Image URL',
        saveCategory: 'Save Category',
        editCategory: 'Edit Category',
        deleteCategory: 'Delete Category',
        deleteCategoryConfirm: 'Are you sure you want to delete this category? All items in this category will be deleted.',
        categorySaved: 'Category saved!',
        categorySavedCloud: 'Category saved — menu updated!',
        categorySavedOffline: 'Category saved on phone — will sync when online.',
        categoryError: 'Category error: ',
        createNewCategory: '+ Create New Category',
        likeItem: 'Like',
        unlikeItem: 'Unlike',
        printReceipt: 'Print',
        offlineMode: 'Offline Mode — changes will sync',
        backOnline: 'Back online — syncing',
        onlineMode: 'Online',
        resetAllData: 'Reset All Data',
        resetConfirm: 'Are you sure you want to delete ALL data? This cannot be undone!',
        resetSuccess: 'All data has been deleted!',
        resetError: 'Error resetting: ',
        expenses: 'Expenses',
        addExpense: '+ Add Expense',
        expenseName: 'Expense Name',
        expensePrice: 'Price (IQD)',
        expenseDate: 'Date',
        expenseTime: 'Time',
        expenseSaved: 'Expense saved!',
        expenseSavedOffline: 'Expense saved on this device — will sync when internet returns.',
        expenseError: 'Error: ',
        expenseDeleted: 'Expense deleted!',
        expenseDeletedOffline: 'Expense removed on this device.',
        totalExpenses: 'Total Expenses',
        todayExpenses: 'Today Expenses',
        monthlyExpenses: 'Monthly Expenses',
        netIncome: 'Net Income',
        noExpenses: 'No expenses yet',
        deleteExpenseConfirm: 'Are you sure you want to delete this expense?',
        water: 'Water',
        milk: 'Milk',
        coffee: 'Coffee',
        electric: 'Electricity',
        gas: 'Gas',
        rent: 'Rent',
        salary: 'Salary',
        other: 'Other',
        cart: 'Cart',
        addToCart: '+ Add to Cart',
        remove: 'Remove',
        cartEmpty: 'Cart is empty',
        cartTotal: 'Total',
        sendWhatsApp: 'Send via WhatsApp',
        useCurrentLocation: '📍 Use Current Location',
        needLocation: 'Please send your location before sending via WhatsApp',
        whatsappPhone: 'WhatsApp Number',
        phonePlaceholder: '+9647701234567',
        orderSent: 'Order sent!',
        quantity: 'Qty',
        themeWhite: 'White',
        themeCream: 'Light Gold',
        themePearl: 'Light Gold',
        themeCoffee: 'Coffee',
        themeGold: 'Gold',
        themeRed: 'Red',
        themeMocha: 'Mocha',
        themeCopper: 'Copper',
        themeOcean: 'Copper',
        themeOlive: 'Olive',
        themeDark: 'Dark',
        cafeOpen: 'Open now',
        cafeClosed: 'Closed now',
        cafeContact: 'Contact',
        cafeCall: 'Call',
        cafeWhatsapp: 'WhatsApp',
        cafeShare: 'Share',
        cafeLocation: 'Location',
        cafeHours: 'Opening hours',
        cafeHoursValue: 'Daily: 2:00 PM — 2:00 AM',
        cafeFollowUs: 'Follow us',
        socialLinks: 'Social media links',
        socialLinksHint: 'Instagram, TikTok, Snapchat & Facebook URLs — shown in Follow us',
        instagramUrl: 'Instagram',
        tiktokUrl: 'TikTok',
        snapchatUrl: 'Snapchat',
        facebookUrl: 'Facebook',
        cafeInfoTitle: 'BREW CAFE & REST',
        linkCopied: 'Link copied!',
        installTitle: 'Add to Home Screen',
        installSubtitle: 'Add our menu to your home screen like an app',
        installIos: 'iPhone (iOS)',
        installAndroid: 'Android',
        installGotIt: 'Got it',
        installDontShow: 'Don\'t show again',
        installShowHelp: 'Add to Home Screen',
        installNow: 'Install now',
        installImagesMissing: 'Add tutorial images to images/install/',
        iosStep1: 'Tap Share (↗) at the bottom of Safari',
        iosStep2: 'Choose «Add to Home Screen»',
        iosStep3: 'Tap «Add» — BREW CAFE & REST icon appears on your home screen',
        androidStep1: 'Tap Menu (⋮) at the top of Chrome',
        androidStep2: 'Choose «Add to Home screen»',
        androidStep3: 'Choose «Install»',
        androidStep4: 'Tap «Install» — BREW CAFE & REST is added to your phone',
    }
};

/* ========================================
   State
   ======================================== */

let cachedMenuItems = [];
let _activeCategory = null;
const ALL_CATEGORY_ID = '__all__';

// Language-specific category orders
const PREFERRED_CATEGORY_ORDER = {
    en: ['Chicken Shawarma', 'Western', 'Bread', 'Appetizer', 'Salad', 'Drinks', 'Coffee', 'Tea', 'Cold Drinks', 'Dessert', 'Shisha', 'Special Drinks'],
    ar: ['شاورما دجاج', 'غربي', 'خبز', 'مقبلات', 'سلطات', 'مشروبات', 'قهوة', 'شاي', 'مشروبات باردة', 'حلويات', 'شيشة', 'مشروبات خاصة'],
    ku: ['Şawirma Mirîşk', 'Rojhilatî', 'Nan', 'Pêşxwar', 'Salata', 'Vexwarin', 'Qehwe', 'Çay', 'Vexwarinên Sar', 'Şîrînî', 'Nargîl', 'Vexwarinên Taybet']
};

// Resolve a category's preferred ordering index, matching by id OR by any of its
// localized name fields (categories created with an auto-generated id, e.g.
// "Chicken Shawarma", would otherwise fall to the end of the list).
function categoryPreferredIndex(cat) {
    if (!cat) return -1;
    var id = (cat.id || '').trim();
    var names = [];
    if (cat.data) {
        ['name_en', 'name_ar', 'name_ku'].forEach(function (k) {
            var n = cat.data[k];
            if (n) names.push(String(n).trim());
        });
    }
    
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var order = PREFERRED_CATEGORY_ORDER[lang] || PREFERRED_CATEGORY_ORDER.ku || PREFERRED_CATEGORY_ORDER.en;
    
    for (var i = 0; i < order.length; i++) {
        var p = order[i].trim();
        if (id === p) return i;
        if (names.indexOf(p) !== -1) return i;
    }
    return -1;
}
let _renderSerial = 0;
let _currentDetailItem = null;
let isOffline = false;
let cartItems = [];
let _lastMenuItemsSignature = '';
let _menuUiReady = false;

/* ========================================
   Menu Loading
   ======================================== */

function parseMenuItemsFromSnapshot(snapshot) {
    const items = [];
    snapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        if (data.category && data.category.toLowerCase().trim() === 'water') return;
        items.push(data);
    });
    return items;
}

function normalizeMenuItemEntry(item) {
    if (!item || !item.id) return null;
    if (item.v && typeof item.v === 'object') {
        return Object.assign({ id: item.id }, item.v);
    }
    return item;
}

function getItemSortOrder(item) {
    if (!item) return 999999;
    var d = (item.data && typeof item.data === 'object') ? item.data : item;
    var ord = d.order != null ? d.order : item.order;
    if (ord != null && ord !== '') {
        var n = Number(ord);
        if (!isNaN(n)) return n;
    }
    return 999999;
}

function sortMenuItemsList(list) {
    if (!Array.isArray(list)) return [];
    return list.slice().sort(function (a, b) {
        var ao = getItemSortOrder(a);
        var bo = getItemSortOrder(b);
        if (ao !== bo) return ao - bo;
        var da = (a && a.data && typeof a.data === 'object') ? a.data : a;
        var db_ = (b && b.data && typeof b.data === 'object') ? b.data : b;
        var ta = da && (da.created_at || da.createdAt) ? String(da.created_at || da.createdAt) : '';
        var tb = db_ && (db_.created_at || db_.createdAt) ? String(db_.created_at || db_.createdAt) : '';
        if (ta && tb && ta !== tb) return ta.localeCompare(tb);
        if (ta && !tb) return -1;
        if (!ta && tb) return 1;
        var idA = String((a && a.id) || '').toLowerCase();
        var idB = String((b && b.id) || '').toLowerCase();
        return idA.localeCompare(idB);
    });
}

function getCategorySortOrder(cat) {
    if (!cat) return 999999;
    var d = (cat.data && typeof cat.data === 'object') ? cat.data : cat;
    var ord = d.order != null ? d.order : cat.order;
    if (ord != null && ord !== '') {
        var n = Number(ord);
        if (!isNaN(n)) return n;
    }
    return 999999;
}

function sortCategoriesList(list) {
    if (!Array.isArray(list)) return [];
    return list.slice().sort(function (a, b) {
        var ao = getCategorySortOrder(a);
        var bo = getCategorySortOrder(b);
        if (ao !== bo) return ao - bo;
        var idA = String((a && a.id) || '').toLowerCase();
        var idB = String((b && b.id) || '').toLowerCase();
        return idA.localeCompare(idB);
    });
}

function normalizeMenuItemsList(items) {
    if (!Array.isArray(items)) return [];
    var list = items.map(normalizeMenuItemEntry).filter(function (item) {
        return item && item.category && item.category.toLowerCase().trim() !== 'water';
    });
    return sortMenuItemsList(list);
}

function waitForFirebaseDb(maxMs) {
    maxMs = maxMs || 8000;
    if (window.dbReady) {
        return Promise.race([
            window.dbReady,
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error('Firebase timeout')); }, maxMs);
            })
        ]);
    }
    return new Promise(function (resolve, reject) {
        if (window.db) {
            resolve(window.db);
            return;
        }
        var start = Date.now();
        var timer = setInterval(function () {
            if (window.db) {
                clearInterval(timer);
                resolve(window.db);
            } else if (Date.now() - start > maxMs) {
                clearInterval(timer);
                reject(new Error('Firebase not loaded'));
            }
        }, 50);
    });
}

function firestoreGetWithTimeout(ref, ms) {
    ms = ms || 8000;
    // Check if ref is a Promise (modular SDK) or has .get() method (old SDK)
    var promise = typeof ref.then === 'function' ? ref : ref.get();
    return Promise.race([
        promise,
        new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error('Connection timeout')); }, ms);
        })
    ]);
}

function isFirestoreApiDisabledError(err) {
    if (!err || !err.message) return false;
    var m = err.message;
    var disabled = m.indexOf('Cloud Firestore API has not been used in project') !== -1 ||
        m.indexOf('SERVICE_DISABLED') !== -1 ||
        m.indexOf('firestore.googleapis.com/overview') !== -1;
    if (disabled) {
        window._firestoreApiDisabled = true;
    }
    return disabled;
}

function showFirestoreApiDisabledAlert() {
    if (window._firestoreApiDisabledAlerted) return;
    window._firestoreApiDisabledAlerted = true;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    var projectId = (window.firebaseConfig && window.firebaseConfig.projectId) || 'brew-coffee-1cd84';
    var url = 'https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=' + encodeURIComponent(projectId);
    alert('⚠️ ' + (strings.errorPrefix || 'Error:') + '\n\nCloud Firestore API is disabled for this project.\n\nPlease enable it here:\n' + url + '\n\nAfter enabling, wait a few minutes and refresh this page.');
}

function clearMenuLoadingSpinner() {
    var container = document.getElementById('menuGrid');
    if (!container) return;
    if (container.querySelector('.loading-menu')) {
        container.innerHTML = '';
    }
}

function menuStillLoading() {
    var container = document.getElementById('menuGrid');
    return !!(container && container.querySelector('.loading-menu'));
}

function paintMenuFromItems(items, options) {
    options = options || {};
    if (!items || !items.length) return false;
    cachedMenuItems = items;
    _lastMenuItemsSignature = menuItemsSignature(items);
    clearMenuLoadingSpinner();
    renderCategories(items, {
        autoSelect: options.autoSelect !== false,
        forceRebuild: true,
        forceFirst: true
    });
    var cat = _activeCategory || (isEmenuPage() ? ALL_CATEGORY_ID : null);
    if (cat) {
        switchCategory(cat, { silent: true, immediate: true, forceRender: true });
    } else {
        autoSelectCategoryAfterRender(true);
    }
    _menuUiReady = true;
    setupCategoryScrollSpy();
    return true;
}

function restFieldValue(field) {
    if (!field || typeof field !== 'object') return null;
    if ('stringValue' in field) return field.stringValue;
    if ('integerValue' in field) return parseInt(field.integerValue, 10);
    if ('doubleValue' in field) return parseFloat(field.doubleValue);
    if ('booleanValue' in field) return !!field.booleanValue;
    if ('nullValue' in field) return null;
    return null;
}

function parseMenuItemsFromRest(json) {
    var items = [];
    (json.documents || []).forEach(function (doc) {
        var f = doc.fields || {};
        var id = doc.name.split('/').pop();
        var category = restFieldValue(f.category);
        if (category && category.toLowerCase().trim() === 'water') return;
        var ordVal = restFieldValue(f.order);
        var ord = (ordVal != null && ordVal !== '' && !isNaN(Number(ordVal))) ? Number(ordVal) : null;
        items.push({
            id: id,
            name_ku: restFieldValue(f.name_ku),
            name_ar: restFieldValue(f.name_ar),
            name_en: restFieldValue(f.name_en),
            price: restFieldValue(f.price),
            category: category,
            image: restFieldValue(f.image),
            available: restFieldValue(f.available) !== false,
            description_ku: restFieldValue(f.description_ku),
            description_ar: restFieldValue(f.description_ar),
            description_en: restFieldValue(f.description_en),
            group_ku: restFieldValue(f.group_ku),
            group_ar: restFieldValue(f.group_ar),
            group_en: restFieldValue(f.group_en),
            order: ord,
            sizes: restFieldValue(f.sizes) || [],
            created_at: restFieldValue(f.created_at) || ''
        });
    });
    return items;
}

function getFirestoreRestBaseUrl() {
    var emulatorInfo = window._firestoreEmulatorInfo;
    if (emulatorInfo) {
        return 'http://' + emulatorInfo.host + ':' + emulatorInfo.port + '/v1/projects/';
    }
    return 'https://firestore.googleapis.com/v1/projects/';
}

function fetchMenuViaRest(timeoutMs) {
    if (window._firestoreApiDisabled) return Promise.reject(new Error('Firestore API disabled'));
    timeoutMs = timeoutMs || 10000;
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId || !cfg.apiKey) {
        return Promise.reject(new Error('Firebase config missing'));
    }
    var baseUrl = getFirestoreRestBaseUrl();
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

    function fetchPage(pageToken) {
        var url = baseUrl + encodeURIComponent(cfg.projectId) +
            '/databases/(default)/documents/menuItems?pageSize=300&key=' + encodeURIComponent(cfg.apiKey);
        if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
        var timer = null;
        var opts = { cache: 'no-store' };
        if (controller) {
            timer = setTimeout(function () { controller.abort(); }, timeoutMs);
            opts.signal = controller.signal;
        }
        return fetch(url, opts).then(function (r) {
            if (timer) clearTimeout(timer);
            if (!r.ok) {
                return r.text().then(function (body) {
                    var msg = 'REST HTTP ' + r.status;
                    if (body && body.indexOf('Cloud Firestore API has not been used') !== -1) {
                        window._firestoreApiDisabled = true;
                        msg = body;
                    }
                    throw new Error(msg);
                });
            }
            return r.json();
        }).then(function (json) {
            var docs = parseMenuItemsFromRest(json);
            if (json.nextPageToken) {
                return fetchPage(json.nextPageToken).then(function (more) {
                    return docs.concat(more);
                });
            }
            return docs;
        });
    }

    return fetchPage(null).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) showFirestoreApiDisabledAlert();
        throw err;
    });
}

function menuItemsSignature(items) {
    if (!items || !items.length) return '';
    return items.map(function (i) {
        return i.id + '|' + (i.available === false ? '0' : '1') + '|' + (i.price || 0) +
            '|' + (i.category || '') + '|' + (i.image || '') +
            '|' + (i.name_ku || '') + '|' + (i.name_ar || '') + '|' + (i.name_en || '') +
            '|' + (i.group_ku || '') + '|' + (i.group_ar || '') + '|' + (i.group_en || '');
    }).sort().join(';');
}

function computeCategoryBarSig(categories, items, lang) {
    var prefix = isEmenuPage() ? 'all|' : '';
    if (categories.length > 0) {
        return prefix + categories.map(function (c) { return c.id; }).join('|') + '|' + lang;
    }
    var found = items.length > 0
        ? new Set(items.map(function (i) { return i.category; }).filter(Boolean).filter(function (c) { return c !== 'Water'; }))
        : new Set();
    return prefix + 'fb|' + Array.from(found).sort().join('|') + '|' + lang;
}

async function loadCategoriesFromFirebase() {
    if (!window.db) return false;
    if (window._firestoreApiDisabled) return false;
    try {
        const catSnap = await firestoreGetWithTimeout(getDocs(collection(db, 'categories')), 8000);
        const categories = [];
        catSnap.forEach(doc => {
            categories.push({ id: doc.id, data: doc.data() });
        });
        sortCategoriesList(categories);
        const sig = categories.map(function (c) { return c.id; }).join('|');
        const prev = localStorage.getItem('cachedCategoriesSig') || '';
        safeSetItem('cachedCategories', JSON.stringify(categories));
        safeSetItem('cachedCategoriesSig', sig);
        if (cachedMenuItems.length > 0) {
            renderCategories(cachedMenuItems, { autoSelect: false, forceRebuild: true });
        }
        return prev !== sig;
    } catch (e) {
        console.error('Error loading categories:', e);
        if (isFirestoreApiDisabledError(e)) {
            showFirestoreApiDisabledAlert();
        }
        return false;
    }
}

function applyMenuItemsUpdate(items, options) {
    options = options || {};
    var rId = getMenuRestaurantId();
    items = normalizeMenuItemsList(items);
    if (!items || !items.length) return;

    const sig = menuItemsSignature(items);
    if (sig === _lastMenuItemsSignature && !options.force && !menuStillLoading()) {
        console.log('[menu] Background data matches displayed items - no reload');
        return;
    }
    _lastMenuItemsSignature = sig;

    cachedMenuItems = items;
    safeSetItem('cachedMenuItems', JSON.stringify(items));
    if (typeof MenuCache !== 'undefined') {
        var currentCats = (window.MenuData && typeof window.MenuData.getCategories === 'function')
            ? window.MenuData.getCategories()
            : [];
        MenuCache.set(rId, items, currentCats);
    }

    const container = document.getElementById('menuGrid');
    if (!container) return;

    clearMenuLoadingSpinner();

    // Only full-repaint if explicitly forced without background flag, or UI not ready yet
    if ((options.force && !options.background) || !_menuUiReady || menuStillLoading()) {
        paintMenuFromItems(items, { autoSelect: false });
        return;
    }

    // Smooth background update: keep current products visible throughout
    const scroll = document.getElementById('categoryScroll');
    const prevCatSig = scroll ? scroll.dataset.categorySig : '';
    renderCategories(items, { autoSelect: false, forceRebuild: false });
    const catBarChanged = scroll && scroll.dataset.categorySig !== prevCatSig;

    if (catBarChanged) {
        autoSelectCategoryAfterRender(true);
    } else if (_activeCategory) {
        switchCategory(_activeCategory, { silent: true, forceRender: true });
    } else if (items.length > 0) {
        autoSelectCategoryAfterRender(true);
    } else {
        container.innerHTML = '';
    }
    setupCategoryScrollSpy();
}

function bindExistingMenuCards() {
    var scroll = document.getElementById('categoryScroll');
    if (scroll) {
        scroll.querySelectorAll('.category-btn').forEach(function (btn) {
            if (!btn._hasMenuClick) {
                btn._hasMenuClick = true;
                btn.addEventListener('click', function () {
                    var cat = btn.getAttribute('data-category');
                    switchCategory(cat);
                });
            }
        });
    }

    var grid = document.getElementById('menuGrid');
    if (!grid) return;

    var items = cachedMenuItems || [];
    var itemsById = {};
    items.forEach(function (it) { if (it && it.id) itemsById[it.id] = it; });

    grid.querySelectorAll('.menu-card').forEach(function (card) {
        var id = card.getAttribute('data-item-id');
        var item = itemsById[id];
        if (!item || card._hasMenuClick) return;
        card._hasMenuClick = true;

        var openDetail = function () { openProductDetail(item); };
        card.addEventListener('click', openDetail);
        card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); }
        });

        card.querySelectorAll('.menu-card-cart, .grid-add-btn').forEach(function (cartBtn) {
            cartBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                cartBtn.classList.add('added');
                setTimeout(function () { cartBtn.classList.remove('added'); }, 700);
                addToCart(item);
            });
        });

        var favBtn = card.querySelector('.menu-card-fav');
        if (favBtn) {
            favBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var nowFav = MENU_FEATURES.toggleFav(item.id);
                favBtn.classList.toggle('is-fav', nowFav);
                var svg = favBtn.querySelector('svg');
                if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
                var lang = localStorage.getItem('selectedLang') || 'ku';
                var strings = i18n[lang] || i18n.en;
                var label = nowFav
                    ? (strings.removeFromFavorites || 'Remove from favorites')
                    : (strings.addToFavorites || 'Add to favorites');
                favBtn.setAttribute('aria-label', label);
                favBtn.setAttribute('title', label);
                updateFavBadge();
            });
        }
    });

    if (typeof syncSectionLayoutIcons === 'function' && typeof getCurrentMenuLayoutMode === 'function') {
        syncSectionLayoutIcons(getCurrentMenuLayoutMode());
    }
}

function showCachedMenuIfAvailable() {
    var rId = getMenuRestaurantId();
    var cache = (window._fastCachedMenu && String(window._fastCachedMenu.restaurantId || '').toLowerCase() === rId)
        ? window._fastCachedMenu
        : (typeof MenuCache !== 'undefined' ? MenuCache.get(rId) : null);

    if (!cache || !Array.isArray(cache.items) || !cache.items.length) {
        return false;
    }

    try {
        var items = normalizeMenuItemsList(cache.items);
        if (!items.length) return false;

        // Set in-memory data for instant display and search/filter
        cachedMenuItems = items;
        if (window.MenuData) {
            if (typeof window.MenuData.setItems === 'function') {
                window.MenuData.setItems(items);
            }
            if (Array.isArray(cache.categories) && cache.categories.length > 0 && typeof window.MenuData.setCategories === 'function') {
                window.MenuData.setCategories(cache.categories);
            }
        }

        // Store restaurant's cached categories in localStorage for category names resolution
        if (Array.isArray(cache.categories) && cache.categories.length > 0) {
            safeSetItem('cachedCategories', JSON.stringify(cache.categories));
            var catSig = cache.categories.map(function (c) { return c.id; }).join('|');
            safeSetItem('cachedCategoriesSig', catSig);
        }

        var grid = document.getElementById('menuGrid');
        if (window._fastMenuAlreadyPainted && grid && grid.querySelector('.menu-card')) {
            console.log('[MenuCache] Fast inline menu already painted for:', rId, '- binding events');
            _menuUiReady = true;
            _activeCategory = ALL_CATEGORY_ID;
            document.body.classList.add('category-selected', 'category-all-active');
            _lastMenuItemsSignature = window._fastMenuSig || menuItemsSignature(items);
            bindExistingMenuCards();
            setupCategoryScrollSpy();
            clearMenuLoadingSpinner();
            return true;
        }

        console.log('[MenuCache] Immediately rendering cached menu for:', rId, 'items:', items.length);
        var painted = paintMenuFromItems(items, { autoSelect: true });
        if (painted) {
            _menuUiReady = true;
            _activeCategory = ALL_CATEGORY_ID;
            document.body.classList.add('category-selected', 'category-all-active');
            clearMenuLoadingSpinner();
        }
        return painted;
    } catch (e) {
        console.error('[MenuCache] Error rendering cache for:', rId, e);
        return false;
    }
}

function handleMenuBackgroundError(err, strings, hadCache) {
    var hasVisibleMenu = _menuUiReady && cachedMenuItems && cachedMenuItems.length > 0;
    if (hasVisibleMenu) {
        // Requirement 13: If cached data exists, keep displaying it and show only a small non-blocking status
        console.warn('[menu] Background refresh error (displaying cached menu):', err && err.message);
        if (typeof showMenuConnectionStatusNow === 'function') {
            showMenuConnectionStatusNow(false);
            if (window._menuStatusHideTimer) clearTimeout(window._menuStatusHideTimer);
            window._menuStatusHideTimer = setTimeout(function () {
                hideMenuConnectionStatus();
            }, 3500);
        }
    } else {
        // Requirement 13: If no cache exists, show the existing error state
        var container = document.getElementById('menuGrid');
        if (container && !_menuUiReady) {
            var msg = (err && err.message) ? err.message : '';
            if (msg.indexOf('permission') !== -1 || msg.indexOf('timeout') !== -1 || msg.indexOf('No DB') !== -1) {
                msg = strings.menuConnectionHint || 'Check connection';
            }
            container.innerHTML = '<div class="empty-state">' +
                '<div class="empty-state-icon">⚠️</div>' +
                '<p>' + (strings.errorLoadingMenu || 'Error loading menu') + '</p>' +
                (msg ? '<p style="font-size:0.8rem;opacity:0.7;margin-top:8px;">' + msg + '</p>' : '') +
                '<button type="button" class="menu-retry-btn" id="menuRetryBtn">' + (strings.menuLoadRetry || 'Retry') + '</button>' +
            '</div>';
            var retry = document.getElementById('menuRetryBtn');
            if (retry) {
                retry.addEventListener('click', function () {
                    loadMenuItems._listenersActive = false;
                    loadMenuItems();
                });
            }
        }
    }
}

async function loadMenuItems() {
    var rId = getMenuRestaurantId();
    const container = document.getElementById('menuGrid');
    const lang = localStorage.getItem('selectedLang') || 'ku';
    const strings = i18n[lang] || i18n.en;
    if (!container) return;

    if (window.location && window.location.search && /[?&]refreshCache(?:=1)?(&|$)/.test(window.location.search)) {
        if (typeof MenuCache !== 'undefined') MenuCache.clear(rId);
        [
            'cachedMenuItems',
            'cachedMenuItemsSig',
            'cachedCategories',
            'cachedCategoriesSig'
        ].forEach(function (key) { localStorage.removeItem(key); });
    }

    // 1. Immediately render valid cached categories & products without waiting for Firebase (Requirement 3)
    const hadCache = showCachedMenuIfAvailable();

    // 2. On first visit with NO cache, show the existing loading indicator (Requirement 6)
    if (!hadCache && !_menuUiReady) {
        var loadingText = strings.loadingMenu || 'داگرتنی مێنوو...';
        if (container && !container.children.length) {
            container.innerHTML = '<div class="loading-menu" data-i18n="loadingMenu">' + loadingText + '</div>';
        }
    } else {
        clearMenuLoadingSpinner();
    }

    // 3. Prevent duplicate Firebase listeners or repeated menu requests when initializing (Requirement 12)
    if (loadMenuItems._activeRestaurant === rId && loadMenuItems._listenersActive) {
        return;
    }
    loadMenuItems._activeRestaurant = rId;
    loadMenuItems._listenersActive = true;

    if (USE_LOCAL_API) {
        localApiRequest('menu_items.php').then(function (items) {
            if (loadMenuItems._loadTimer) {
                clearTimeout(loadMenuItems._loadTimer);
                loadMenuItems._loadTimer = null;
            }
            if (typeof MenuCache !== 'undefined') {
                MenuCache.set(rId, items, []);
            }
            applyMenuItemsUpdate(items, { force: !hadCache, background: hadCache });
        }).catch(function (err) {
            console.warn('[menu] Local API load failed:', err.message);
            handleMenuBackgroundError(err, strings, hadCache);
        });
        return;
    }

    // 4. Fetch latest categories and products from Firebase in background (Requirement 4)
    var _freshCategories = null;

    MenuData.loadCategories(4000, function (categories) {
        console.log('[menu] Categories loaded from Firebase:', categories.length);
        _freshCategories = categories;
        safeSetItem('cachedCategories', JSON.stringify(categories));
        var sig = categories.map(function (c) { return c.id; }).join('|');
        var prevSig = localStorage.getItem('cachedCategoriesSig') || '';
        safeSetItem('cachedCategoriesSig', sig);

        // Update restaurant-specific cache with categories
        var currentItems = cachedMenuItems && cachedMenuItems.length ? cachedMenuItems : MenuData.getItems();
        if (typeof MenuCache !== 'undefined' && currentItems && currentItems.length > 0) {
            MenuCache.set(rId, currentItems, categories);
        }

        // Only reflect category changes if categories actually changed
        if (prevSig !== sig) {
            if (cachedMenuItems && cachedMenuItems.length > 0) {
                renderCategories(cachedMenuItems, { autoSelect: false, forceRebuild: true });
            } else {
                renderCategories([], { autoSelect: false, forceRebuild: true });
            }
        }
    }, function (err) {
        console.warn('[menu] MenuData categories error:', err && err.message);
        handleMenuBackgroundError(err, strings, hadCache);
    });

    MenuData.loadItems(4000, function (items) {
        if (loadMenuItems._loadTimer) {
            clearTimeout(loadMenuItems._loadTimer);
            loadMenuItems._loadTimer = null;
        }
        console.log('[menu] Menu items loaded from Firebase:', items.length);

        // 5. Replace cached menu with fresh Firebase data only after received & processed (Requirement 5)
        var cats = _freshCategories || (MenuData.getCategories && MenuData.getCategories().length ? MenuData.getCategories() : null);
        if (!cats) {
            var rawCats = localStorage.getItem('cachedCategories');
            if (rawCats) {
                try { cats = JSON.parse(rawCats); } catch (e) {}
            }
        }
        if (typeof MenuCache !== 'undefined') {
            MenuCache.set(rId, items, cats || []);
        }

        // 7 & 8. Smoothly reflect updates without full-page spinner or hiding products
        applyMenuItemsUpdate(items, { force: !hadCache && !_menuUiReady, background: hadCache });
    }, function (err) {
        console.warn('[menu] MenuData load failed:', err && err.message);
        handleMenuBackgroundError(err, strings, hadCache);
    });
}

function handleMenuLoadFailure(error, strings, hadCache) {
    loadFromCache();
    if (_menuUiReady && !menuStillLoading()) return;
    if (isFirestoreApiDisabledError(error)) {
        showFirestoreApiDisabledAlert();
    }
    showMenuLoadError(strings, error);
}

function showMenuLoadError(strings, error) {
    var container = document.getElementById('menuGrid');
    if (!container || (_menuUiReady && !menuStillLoading())) return;
    var msg = (error && error.message) ? error.message : '';
    if (msg.indexOf('permission') !== -1 || msg.indexOf('Missing or insufficient') !== -1) {
        msg = strings.menuConnectionHint;
    } else if (msg.indexOf('timeout') !== -1 || msg.indexOf('Timeout') !== -1) {
        msg = strings.menuConnectionHint;
    }
    if (!msg && window.location && window.location.hostname) {
        msg = strings.menuConnectionHint + ' (' + window.location.hostname + ')';
    }
    container.innerHTML =
        '<div class="empty-state">' +
            '<div class="empty-state-icon">⚠️</div>' +
            '<p>' + strings.errorLoadingMenu + '</p>' +
            (msg ? '<p style="font-size:0.8rem;margin-top:8px;opacity:0.85">' + msg + '</p>' : '') +
            '<button type="button" class="menu-retry-btn" id="menuRetryBtn">' + strings.menuLoadRetry + '</button>' +
        '</div>';
    var retry = document.getElementById('menuRetryBtn');
    if (retry) {
        retry.addEventListener('click', function () {
            loadMenuItems._inProgress = false;
            loadMenuItems();
        });
    }
    renderCategories([], { forceRebuild: true, autoSelect: false });
}

function fetchMenuItemsFallback(strings, reason) {
    if (window._firestoreApiDisabled) return;
    if (_menuUiReady && !menuStillLoading()) return;
    fetchMenuViaRest(10000).then(function (items) {
        if (loadMenuItems._loadTimer) {
            clearTimeout(loadMenuItems._loadTimer);
            loadMenuItems._loadTimer = null;
        }
        applyMenuItemsUpdate(items, { force: true });
    }).catch(function (restErr) {
        console.warn('[menu] REST fallback failed (' + reason + '):', restErr.message);
        if (!window.db) {
            if (!_menuUiReady) showMenuLoadError(strings, restErr);
            return;
        }
        firestoreGetWithTimeout(getDocs(collection(db, 'menuItems')), 8000).then(function (snap) {
            if (loadMenuItems._loadTimer) {
                clearTimeout(loadMenuItems._loadTimer);
                loadMenuItems._loadTimer = null;
            }
            applyMenuItemsUpdate(parseMenuItemsFromSnapshot(snap), { force: true });
        }).catch(function (err) {
            console.warn('[menu] SDK fallback get failed (' + reason + '):', err.message);
            if (!_menuUiReady) showMenuLoadError(strings, err);
        });
    });
}

function loadFromCache() {
    var strings = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var container = document.getElementById('menuGrid');
    if (!container) return;

    var cached = localStorage.getItem('cachedMenuItems');
    if (cached) {
        try {
            var items = normalizeMenuItemsList(JSON.parse(cached));
            if (items.length > 0) {
                console.log('Loaded from cache:', items.length);
                paintMenuFromItems(items, { autoSelect: true });
                return;
            }
            clearMenuLoadingSpinner();
            container.innerHTML = '';
        } catch (e) {
            console.error('Error parsing cache:', e);
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>' + strings.errorLoadingMenu + '</p>';
        }
    } else {
        clearMenuLoadingSpinner();
        container.innerHTML = '';
    }
}

window.addEventListener('pagehide', function () {
    if (loadMenuItems._unsubscribe) loadMenuItems._unsubscribe();
});

function isEmenuPage() {
    return document.body.classList.contains('emenu-layout');
}

function allCategoryIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/>' +
        '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>' +
        '</svg>';
}

function buildAllCategoryButton(label) {
    if (!label) {
        var lang = localStorage.getItem('selectedLang') || 'ku';
        var strings = i18n[lang] || i18n.en;
        label = strings.allItems || strings.all || 'All';
    }
    return '<button class="category-btn category-btn-all active" data-category="' + ALL_CATEGORY_ID + '">' +
        '<span class="cat-icon cat-all-mark" aria-hidden="true">' + allCategoryIconSvg() + '</span>' +
        '<span class="cat-label">' + label + '</span></button>';
}

function filterItemsByCategory(items, category) {
    if (category === ALL_CATEGORY_ID || category === 'all') return items || MenuData.getItems();
    var catLower = String(category).toLowerCase();
    var source = items && items.length ? items : MenuData.getItems();
    return source.filter(function (i) { 
        if (!i.category) return false;
        if (String(i.category) === String(category)) return true;
        if (String(i.category).toLowerCase() === catLower) return true;
        return false;
    });
}

function renderCategories(items, options) {
    options = options || {};
    var scroll = document.getElementById('categoryScroll');
    if (!scroll) return;
    console.log('[renderCategories] Starting render, items:', items.length);
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    var rId = getMenuRestaurantId();
    var activeCache = (typeof MenuCache !== 'undefined') ? MenuCache.get(rId) : null;
    let categories = [];
    if (activeCache && Array.isArray(activeCache.categories) && activeCache.categories.length > 0) {
        categories = activeCache.categories.slice();
    } else {
        const cachedCats = localStorage.getItem('cachedCategories');
        if (cachedCats) {
            try {
                categories = JSON.parse(cachedCats);
                console.log('[renderCategories] Loaded cached categories:', categories.length);
            } catch (e) {
                console.error('Error parsing cached categories:', e);
            }
        }
    }
    if ((!categories || !categories.length) && window.MenuData && typeof window.MenuData.getCategories === 'function') {
        categories = (window.MenuData.getCategories() || []).slice();
    }
    var seenCat = {};
    categories = categories.filter(function (c) {
        if (!c || !c.id) return false;
        var lower = String(c.id).toLowerCase();
        if (seenCat[lower]) return false;
        seenCat[lower] = true;
        return true;
    });
    categories = sortCategoriesList(categories);
    let html = '';
    categories.forEach(cat => {
        var catData = (cat.data && typeof cat.data === 'object') ? cat.data : cat;
        var name = catData['name_' + lang] || catData.name_en || catData.name_ku || catData.name_ar || strings.unnamed;
        var safeName = String(name).replace(/"/g, '&quot;');
        var icon;
        if (catData.image) {
            icon =
                '<img class="cat-icon" src="' + catData.image + '" alt="' + safeName + '" ' +
                'onerror="var f=this.nextElementSibling;this.remove();if(f){f.hidden=false;f.classList.add(\'is-visible\');}">' +
                '<svg class="cat-icon cat-icon-fallback" hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>';
        } else {
            icon = '<svg class="cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>';
        }
        html += '<button class="category-btn" data-category="' + cat.id + '">' + icon + '<span class="cat-label">' + name + '</span></button>';
    });
    scroll.innerHTML = html;
    scroll.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.getAttribute('data-category');
            switchCategory(cat);
        });
    });
    if (options.autoSelect !== false) {
        autoSelectCategoryAfterRender(options.forceFirst);
    }
}

function autoSelectCategoryAfterRender(forceFirst) {
    var scroll = document.getElementById('categoryScroll');
    if (!scroll) return;
    var target = _activeCategory;
    if (forceFirst || !target || target === ALL_CATEGORY_ID) {
        // No "All" pill — show every section, highlight the first real category.
        if (isEmenuPage()) {
            ensureAllCategoriesRendered();
            var firstBtn = scroll.querySelector('.category-btn');
            if (firstBtn) {
                document.querySelectorAll('.category-btn').forEach(function (btn) {
                    btn.classList.toggle('active', btn === firstBtn);
                });
                scrollCategoryBarToActive();
            }
            return;
        }
        target = ALL_CATEGORY_ID;
    }
    if (target) {
        var exists = scroll.querySelector('.category-btn[data-category="' + target + '"]');
        if (exists) {
            switchCategory(target, { immediate: true, silent: true });
            scrollCategoryBarToActive();
        } else if (scroll.querySelector('.category-btn')) {
            var firstBtn = scroll.querySelector('.category-btn');
            switchCategory(firstBtn.getAttribute('data-category'), { immediate: true, silent: true });
            scrollCategoryBarToActive();
        }
    }
}

function clearCategorySelection() {
    _activeCategory = null;
    document.body.classList.remove('category-selected');
    document.body.classList.remove('category-all-active');

    document.querySelectorAll('.category-btn').forEach(function (btn) {
        btn.classList.remove('active');
    });

    // Restore the background video to how it looked before any category was picked.
    var bgVideo = document.querySelector('.bg-video');
    if (bgVideo) {
        bgVideo.style.visibility = '';
        var playPromise = bgVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function () {});
        }
    }

    var grid = document.getElementById('menuGrid');
    if (grid) {
        grid.classList.add('category-switching');
        setTimeout(function () {
            grid.innerHTML = '';
            grid.classList.remove('category-switching');
        }, 150);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getCategoryBarHeight() {
    var bar = document.getElementById('categoryBar');
    return bar ? Math.ceil(bar.getBoundingClientRect().height) : 72;
}

function setCategoryPillActive(category) {
    document.querySelectorAll('.category-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-category') === category);
    });
    scrollCategoryBarToActive();
}

var MENU_LAYOUT_GRID_ICON = '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>';
var MENU_LAYOUT_LIST_ICON = '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>';

function getCurrentMenuLayoutMode() {
    var grid = document.getElementById('menuGrid');
    if (grid && grid.classList.contains('layout-vertical')) return 'list';
    try {
        return localStorage.getItem('menuLayoutMode') === 'list' ? 'list' : 'grid';
    } catch (e) {
        return 'grid';
    }
}

function createSectionLayoutButton() {
    var mode = getCurrentMenuLayoutMode();
    var isList = mode === 'list';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-layout-icon';
    btn.setAttribute('aria-label', isList ? 'List layout' : 'Grid layout');
    btn.setAttribute('data-layout', mode);
    btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        (isList ? MENU_LAYOUT_LIST_ICON : MENU_LAYOUT_GRID_ICON) +
        '</svg>';
    return btn;
}

function wrapCategoryHeadingWithLayout(headingEl) {
    var row = document.createElement('div');
    row.className = 'category-heading-row';
    row.appendChild(createSectionLayoutButton());
    row.appendChild(headingEl);
    return row;
}

function syncSectionLayoutIcons(mode) {
    var isList = mode === 'list';
    var iconHtml = isList ? MENU_LAYOUT_LIST_ICON : MENU_LAYOUT_GRID_ICON;
    document.querySelectorAll('.section-layout-icon').forEach(function (el) {
        el.setAttribute('aria-label', isList ? 'List layout' : 'Grid layout');
        el.setAttribute('data-layout', mode);
        var svg = el.querySelector('svg');
        if (svg) svg.innerHTML = iconHtml;
    });
}

function scrollToCategorySection(category, behavior) {
    behavior = behavior || 'smooth';
    window._categoryClickScrolling = true;
    if (window._categoryClickScrollTimer) clearTimeout(window._categoryClickScrollTimer);

    var barH = getCategoryBarHeight() + 8;
    var y;

    if (category === ALL_CATEGORY_ID || category === 'all') {
        var sheet = document.querySelector('.menu-sheet');
        if (sheet) {
            y = sheet.getBoundingClientRect().top + window.pageYOffset;
        } else {
            y = 0;
        }
    } else {
        var targetSection = document.getElementById('category-section-' + category);
        if (!targetSection) {
            window._categoryClickScrolling = false;
            return;
        }
        y = targetSection.getBoundingClientRect().top + window.pageYOffset - barH;
    }

    window.scrollTo({ top: Math.max(0, y), behavior: behavior });
    window._categoryClickScrollTimer = setTimeout(function () {
        window._categoryClickScrolling = false;
    }, behavior === 'smooth' ? 900 : 80);
}

function ensureAllCategoriesRendered(force) {
    var needsRender = force || _activeCategory !== ALL_CATEGORY_ID || menuStillLoading() ||
        !document.querySelector('[data-category-section]');
    _activeCategory = ALL_CATEGORY_ID;
    document.body.classList.add('category-selected', 'category-all-active');
    if (needsRender) {
        renderMenuItems(filterItemsByCategory(cachedMenuItems, ALL_CATEGORY_ID));
        renderMenuCardsWithFeatures();
        if (window._observeCategorySections) window._observeCategorySections();
    }
}

function switchCategory(category, options) {
    options = options || {};
    if (category === 'all') category = ALL_CATEGORY_ID;
    var emenu = isEmenuPage();

    /* E-menu: keep full list, sticky bar scrolls to sections (restaurant-app style) */
    if (emenu && !options.forceFilter) {
        ensureAllCategoriesRendered(options.forceRender || options.force);
        setCategoryPillActive(category);

        if (options.silent) return;

        scrollToCategorySection(
            category,
            (options.immediate || menuStillLoading()) ? 'auto' : 'smooth'
        );
        return;
    }

    if (_activeCategory === category) {
        if (options.silent || options.immediate || menuStillLoading()) {
            renderMenuItems(filterItemsByCategory(cachedMenuItems, category));
            renderMenuCardsWithFeatures();
            return;
        }
        if (!document.body.classList.contains('emenu-layout')) {
            clearCategorySelection();
        }
        return;
    }

    _activeCategory = category;
    document.body.classList.add('category-selected');
    document.body.classList.toggle('category-all-active', category === ALL_CATEGORY_ID || category === 'all');

    setCategoryPillActive(category);

    const grid = document.getElementById('menuGrid');
    if (!grid) return;

    if (options.silent || options.immediate) {
        renderMenuItems(filterItemsByCategory(cachedMenuItems, category));
        renderMenuCardsWithFeatures();
        return;
    }

    grid.classList.add('category-switching');

    setTimeout(() => {
        renderMenuItems(filterItemsByCategory(cachedMenuItems, category));
        renderMenuCardsWithFeatures();
        grid.classList.remove('category-switching');
    }, 200);

    if (options.immediate) return;
    var targetSection = document.getElementById('category-section-' + category);
    if (targetSection) {
        setTimeout(function () {
            targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 250);
    } else {
        var gridTop = grid.getBoundingClientRect().top + window.scrollY - 100;
        window.scrollTo({ top: gridTop, behavior: 'smooth' });
    }
}

function scrollCategoryBarToActive() {
    var scroll = document.getElementById('categoryScroll');
    if (!scroll) return;
    var activeBtn = scroll.querySelector('.category-btn.active');
    if (!activeBtn) return;
    if (scroll.scrollWidth <= scroll.clientWidth) return;
    var scrollLeft = activeBtn.offsetLeft - (scroll.clientWidth / 2) + (activeBtn.clientWidth / 2);
    scroll.scrollTo({ left: scrollLeft, behavior: 'smooth' });
}

function setupStickyCategoryBar() {
    if (!isEmenuPage() || window._stickyCategoryBarReady) return;
    var bar = document.getElementById('categoryBar');
    var sentinel = document.getElementById('categoryBarSentinel');
    var spacer = document.getElementById('categoryBarSpacer');
    if (!bar || !sentinel || !spacer) return;
    window._stickyCategoryBarReady = true;

    function syncSpacer() {
        if (bar.classList.contains('is-stuck')) {
            spacer.style.height = getCategoryBarHeight() + 'px';
        }
    }

    var io = new IntersectionObserver(function (entries) {
        var entry = entries[0];
        if (!entry) return;
        var shouldStick = !entry.isIntersecting && entry.boundingClientRect.top < 1;
        bar.classList.toggle('is-stuck', shouldStick);
        document.body.classList.toggle('category-bar-stuck', shouldStick);
        if (shouldStick) {
            spacer.style.height = getCategoryBarHeight() + 'px';
        } else {
            spacer.style.height = '0px';
        }
    }, { threshold: [0, 1], rootMargin: '0px 0px 0px 0px' });

    io.observe(sentinel);
    window.addEventListener('resize', syncSpacer, { passive: true });
    window._syncStickyCategoryBar = syncSpacer;
}

function setupCategoryScrollSpy() {
    if (window._categoryScrollSpy) return;
    window._categoryScrollSpy = true;

    setupStickyCategoryBar();

    var sections = [];
    var observer = new IntersectionObserver(function (entries) {
        if (window._categoryClickScrolling) return;

        var visible = [];
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            visible.push(entry);
        });

        /* Also check currently observed sections for the topmost in the active band */
        if (!visible.length) {
            sections.forEach(function (el) {
                var rect = el.getBoundingClientRect();
                var bandTop = getCategoryBarHeight();
                var bandBottom = window.innerHeight * 0.45;
                if (rect.top < bandBottom && rect.bottom > bandTop + 20) {
                    visible.push({ target: el, boundingClientRect: rect });
                }
            });
        }
        if (!visible.length) return;

        visible.sort(function (a, b) {
            return a.boundingClientRect.top - b.boundingClientRect.top;
        });
        var activeCat = visible[0].target.getAttribute('data-category-section');
        if (!activeCat) return;

        setCategoryPillActive(activeCat);
    }, {
        root: null,
        rootMargin: '-12% 0px -55% 0px',
        threshold: [0, 0.15, 0.4]
    });

    function observeSections() {
        sections.forEach(function (s) { observer.unobserve(s); });
        sections = [];
        document.querySelectorAll('[data-category-section]').forEach(function (el) {
            sections.push(el);
            observer.observe(el);
        });
        if (window._syncStickyCategoryBar) window._syncStickyCategoryBar();
    }

    window._observeCategorySections = observeSections;
    observeSections();
}

/* ========================================
   Menu Items Rendering
   ======================================== */

var MENU_FEATURES = window.MENU_FEATURES || {
    getFavorites: function () {
        try {
            var raw = JSON.parse(localStorage.getItem('menu_favorites') || '[]');
            if (Array.isArray(raw)) return raw.map(function(id) { return String(id); });
            return [];
        } catch (e) { return []; }
    },
    toggleFav: function (id) {
        id = String(id);
        var favs = this.getFavorites();
        var idx = favs.indexOf(id);
        if (idx > -1) { favs.splice(idx, 1); } else { favs.push(id); }
        localStorage.setItem('menu_favorites', JSON.stringify(favs));
        return idx === -1;
    },
    isFav: function (id) {
        return this.getFavorites().indexOf(String(id)) > -1;
    },
    clearAll: function () {
        localStorage.setItem('menu_favorites', JSON.stringify([]));
    }
};
window.MENU_FEATURES = MENU_FEATURES;

function createMenuCard(item, lang, strings) {
    const card = document.createElement('div');
    card.className = 'menu-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-item-id', item.id);

    const name = item[`name_${lang}`] || item.name_en || item.name_ar || item.name_ku || 'Unnamed Item';
    const description = item[`description_${lang}`] || item.description_en || item.description_ar || item.description_ku || '';
    const fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%231a1a1a width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2740%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23D4AF37%27%3E%E2%98%95%3C/text%3E%3C/svg%3E';
    const imageUrl = normalizeImageUrl(item.image) || fallbackImage;

    let categoryName = '';
    var rId = getMenuRestaurantId();
    var activeCache = (typeof MenuCache !== 'undefined') ? MenuCache.get(rId) : null;
    var cachedCats = (activeCache && Array.isArray(activeCache.categories) && activeCache.categories.length > 0)
        ? activeCache.categories
        : null;
    if (!cachedCats) {
        var rawCats = localStorage.getItem('cachedCategories');
        if (rawCats) {
            try { cachedCats = JSON.parse(rawCats); } catch (e) {}
        }
    }
    if (cachedCats && item.category) {
        var lower = String(item.category).toLowerCase();
        var cat = cachedCats.find(c => c.id === item.category) ||
            cachedCats.find(c => c.id && String(c.id).toLowerCase() === lower);
        if (cat) {
            var catData = (cat.data && typeof cat.data === 'object') ? cat.data : cat;
            categoryName = catData['name_' + lang] || catData.name_en || '';
        }
    }
    if (!categoryName && item.category) {
        const key = item.category.replace(/\s+/g, '');
        const lookupKey = key.charAt(0).toLowerCase() + key.slice(1);
        categoryName = strings[lookupKey] || item.category;
    }

    const isEmenu = document.body.classList.contains('emenu-layout');
    var sizeBadgeHtml = '';
    var hasSizes = item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0;
    var priceText = '';
    var currStr = (lang === 'en') ? ' IQD' : ' د.ع';
    if (hasSizes) {
        var validPrices = item.sizes.map(function(s) { return Number(s.price) || 0; }).filter(function(p) { return p > 0; });
        if (validPrices.length > 0) {
            var minP = Math.min.apply(null, validPrices);
            var maxP = Math.max.apply(null, validPrices);
            if (minP !== maxP) {
                // Screenshot 1: In RTL displays "6,000 - 2,000 د.ع" / in LTR "2,000 - 6,000 IQD"
                var rangeStr = (lang === 'en')
                    ? (minP.toLocaleString() + ' - ' + maxP.toLocaleString())
                    : (maxP.toLocaleString() + ' - ' + minP.toLocaleString());
                priceText = '<span class="card-price-range">' + rangeStr + currStr + '</span>';
            } else {
                priceText = '<span class="card-price-range">' + minP.toLocaleString() + currStr + '</span>';
            }
        }
    }
    if (!priceText) {
        priceText = '<span class="card-price-single">' + (item.price ? Number(item.price).toLocaleString() : '0') + currStr + '</span>';
    }

    var descHtml = description
        ? `<span class="menu-card-foot-desc">${description}</span>`
        : '';

    const isFav = MENU_FEATURES.isFav(item.id);
    const favLabel = isFav ? (strings.removeFromFavorites || 'Remove from favorites') : (strings.addToFavorites || 'Add to favorites');
    const favBtnHtml =
        '<button type="button" class="menu-card-fav' + (isFav ? ' is-fav' : '') + '" data-item-id="' + item.id + '" aria-label="' + favLabel + '" title="' + favLabel + '">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.9">' +
                '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
            '</svg>' +
        '</button>';

    if (isEmenu) {
        card.innerHTML = `
            <div class="menu-card-img-wrapper">
                <img src="${imageUrl}" alt="${name}" class="menu-card-img" loading="lazy"
                     onerror="this.onerror=null;this.src='${fallbackImage}';">
                ${favBtnHtml}
                <button class="menu-card-cart menu-card-add grid-add-btn" data-item-id="${item.id}" aria-label="Add to Cart" type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>
            </div>
            <div class="menu-card-foot">
                <div class="menu-card-content menu-card-foot-text">
                    <span class="menu-card-title menu-card-foot-title">${name}</span>
                    ${descHtml}
                    <span class="menu-card-price menu-card-foot-price">${priceText}</span>
                </div>
            </div>
        `;
    } else {
        card.innerHTML = `
            <div class="menu-card-img-wrapper">
                <img src="${imageUrl}" alt="${name}" class="menu-card-img" loading="lazy"
                     onerror="this.onerror=null;this.src='${fallbackImage}';">
                ${favBtnHtml}
                <div class="menu-card-badge">${categoryName}</div>
            </div>
            <div class="menu-card-body">
                <h2 class="menu-card-title">${name}${sizeBadgeHtml}</h2>
                ${description ? `<p class="menu-card-desc">${description}</p>` : '<p class="menu-card-desc" style="opacity:0">—</p>'}
                <div class="menu-card-footer">
                    <div class="price-tag">
                        ${priceText}
                    </div>
                    <div class="menu-card-foot-actions">
                        <button class="menu-card-cart" data-item-id="${item.id}" aria-label="Add to Cart">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="9" cy="21" r="1"></circle>
                                <circle cx="20" cy="21" r="1"></circle>
                                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    const openDetail = () => openProductDetail(item);
    card.addEventListener('click', openDetail);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } });

    card.querySelectorAll('.menu-card-cart, .grid-add-btn').forEach((cartBtn) => {
        cartBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            cartBtn.classList.add('added');
            setTimeout(() => cartBtn.classList.remove('added'), 700);

            addToCart(item);
        });
    });

    const favBtn = card.querySelector('.menu-card-fav');
    if (favBtn) {
        favBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var nowFav = MENU_FEATURES.toggleFav(item.id);
            favBtn.classList.toggle('is-fav', nowFav);
            var svg = favBtn.querySelector('svg');
            if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
            var label = nowFav
                ? (strings.removeFromFavorites || 'Remove from favorites')
                : (strings.addToFavorites || 'Add to favorites');
            favBtn.setAttribute('aria-label', label);
            favBtn.setAttribute('title', label);
            updateFavBadge();
        });
    }

    return card;
}

function appendCategorySection(container, catId, catItems, lang, strings) {
    const section = document.createElement('div');
    section.className = 'category-section';
    section.setAttribute('data-category-section', catId);
    section.id = 'category-section-' + catId;

    const header = document.createElement('div');
    header.className = 'category-section-header';
    header.textContent = getCategoryDisplayName(catId, lang);
    section.appendChild(wrapCategoryHeadingWithLayout(header));

    catItems.forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
    return section;
}

function renderMenuItems(items) {
    const container = document.getElementById('menuGrid');
    if (!container) return;

    _renderSerial++;
    const lang = localStorage.getItem('selectedLang') || 'ku';
    const strings = i18n[lang] || i18n.en;

    container.innerHTML = '';

    if (!items || items.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">☕</div><p>${strings.noCategoryItems}</p></div>`;
        return;
    }

     const availableItems = sortMenuItemsList(items.filter(item => item.available !== false));

     // Grouped "All" view: render items inside category sections
     if (_activeCategory === ALL_CATEGORY_ID && availableItems.length > 0) {
          const groups = {};
          let categoryOrder = [];
          const categoryExactMap = {};
          try {
              var allCats = [];
              if (window.MenuData && typeof window.MenuData.getCategories === 'function') {
                  allCats = (window.MenuData.getCategories() || []).slice();
              }
              var rId = getMenuRestaurantId();
              var activeCache = (typeof MenuCache !== 'undefined') ? MenuCache.get(rId) : null;
              var cachedCats = (activeCache && Array.isArray(activeCache.categories) && activeCache.categories.length > 0)
                  ? activeCache.categories
                  : JSON.parse(localStorage.getItem('cachedCategories') || '[]');
              if (Array.isArray(cachedCats)) {
                  cachedCats.forEach(function (cc) {
                      if (cc && cc.id && !allCats.some(function (x) { return x && x.id === cc.id; })) {
                          allCats.push(cc);
                      }
                  });
              }
              allCats = sortCategoriesList(allCats);
              allCats.forEach(function (c) {
                  if (c && c.id) {
                      categoryExactMap[c.id] = c.id;
                      if (categoryOrder.indexOf(c.id) === -1) categoryOrder.push(c.id);
                  }
              });
          } catch (e) {}

          availableItems.forEach(item => {
              let cat = item.category || '__uncategorized';
              if (cat !== '__uncategorized') {
                  if (categoryExactMap[cat]) {
                      cat = categoryExactMap[cat];
                  }
              }
              if (!groups[cat]) groups[cat] = [];
              groups[cat].push(item);
          });

         Object.keys(groups).forEach(function (catId) {
             if (catId && categoryOrder.indexOf(catId) === -1) categoryOrder.push(catId);
         });

        categoryOrder.forEach(catId => {
            if (!groups[catId]) return;
            const section = document.createElement('div');
            section.className = 'category-section';
            section.setAttribute('data-category-section', catId);
            section.id = 'category-section-' + catId;

            const heading = document.createElement('h3');
            heading.className = 'category-heading';
            heading.textContent = getCategoryDisplayName(catId, lang);
            section.appendChild(wrapCategoryHeadingWithLayout(heading));

            const itemsByGroup = {};
            const ungrouped = [];
            const sortedGroupItems = sortMenuItemsList(groups[catId]);
            sortedGroupItems.forEach(item => {
                const g = (item.group_ku || item.group_ar || item.group_en || item.group || '').trim();
                if (!g) {
                    ungrouped.push(item);
                    return;
                }
                const key = item['group_' + (lang === 'ar' ? 'ar' : lang === 'en' ? 'en' : 'ku')] || item.group || g;
                if (!itemsByGroup[key]) itemsByGroup[key] = [];
                itemsByGroup[key].push(item);
            });

            const groupOrder = Object.keys(itemsByGroup);
            groupOrder.forEach(g => {
                const groupHeading = document.createElement('h4');
                groupHeading.className = 'group-heading';
                groupHeading.textContent = g;
                section.appendChild(groupHeading);
                sortMenuItemsList(itemsByGroup[g]).forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
            });

            sortMenuItemsList(ungrouped).forEach(item => section.appendChild(createMenuCard(item, lang, strings)));

            container.appendChild(section);
        });

        if (window._observeCategorySections) window._observeCategorySections();
        return;
    }

    // Flat rendering (single category or legacy path)
    if (availableItems.length > 0) {
        const section = document.createElement('div');
        section.className = 'category-section';
        section.setAttribute('data-category-section', _activeCategory);
        section.id = 'category-section-' + _activeCategory;

        const heading = document.createElement('h3');
        heading.className = 'category-heading';
        heading.textContent = getCategoryDisplayName(_activeCategory, lang);
        section.appendChild(wrapCategoryHeadingWithLayout(heading));

        const itemsByGroup = {};
        const ungrouped = [];
        const sortedFlatItems = sortMenuItemsList(availableItems);
        sortedFlatItems.forEach(item => {
            const g = (item.group_ku || item.group_ar || item.group_en || item.group || '').trim();
            if (!g) {
                ungrouped.push(item);
                return;
            }
            const key = item['group_' + (lang === 'ar' ? 'ar' : lang === 'en' ? 'en' : 'ku')] || item.group || g;
            if (!itemsByGroup[key]) itemsByGroup[key] = [];
            itemsByGroup[key].push(item);
        });

        const groupOrder = Object.keys(itemsByGroup);
        groupOrder.forEach(g => {
            const groupHeading = document.createElement('h4');
            groupHeading.className = 'group-heading';
            groupHeading.textContent = g;
            section.appendChild(groupHeading);
            sortMenuItemsList(itemsByGroup[g]).forEach(item => section.appendChild(createMenuCard(item, lang, strings)));
        });

        sortMenuItemsList(ungrouped).forEach(item => section.appendChild(createMenuCard(item, lang, strings)));

        container.appendChild(section);
    }
}

/* ========================================
   Product Detail Modal
   ======================================== */

var _detailScrollY = 0;

function lockPageScroll() {
    _detailScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + _detailScrollY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
}

function unlockPageScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, _detailScrollY);
}

function getCategoryDisplayName(categoryId, lang) {
    if (!categoryId) return '';
    lang = lang || localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    if (categoryId === ALL_CATEGORY_ID || categoryId === 'all' || categoryId === '__all__') {
        return strings.allItems || strings.all || 'All';
    }
    
    // Helper to find name from a categories array
    function findName(categories, catId) {
        if (!categories) return null;
        var cat = categories.find(function (c) { return c.id === catId; });
        if (!cat) {
            var lower = String(catId).toLowerCase();
            cat = categories.find(function (c) { return c.id && String(c.id).toLowerCase() === lower; });
        }
        if (cat && cat.data) {
            return cat.data['name_' + lang] || cat.data.name_en || null;
        }
        return null;
    }
    
    // First try in-memory categories from MenuData (most up-to-date)
    if (window.MenuData && typeof window.MenuData.getCategories === 'function') {
        var memName = findName(window.MenuData.getCategories(), categoryId);
        if (memName) return memName;
    }
    
    // Then try restaurant-specific cached categories
    var rId = getMenuRestaurantId();
    var activeCache = (typeof MenuCache !== 'undefined') ? MenuCache.get(rId) : null;
    if (activeCache && Array.isArray(activeCache.categories)) {
        var cName = findName(activeCache.categories, categoryId);
        if (cName) return cName;
    }
    var cachedCats = localStorage.getItem('cachedCategories');
    if (cachedCats) {
        try {
            var categories = JSON.parse(cachedCats);
            var name = findName(categories, categoryId);
            if (name) return name;
        } catch (e) {}
    }
    
    // If categoryId looks like a descriptive name (not a Firestore doc ID), use it directly
    // Firestore doc IDs are typically short (UUID-like or alphanumeric without spaces)
    // Display names like "Chicken Shawarma" contain spaces
    if (String(categoryId).indexOf(' ') !== -1) {
        return categoryId;
    }
    
    // Fallback: check i18n mapping or return the ID as last resort
    var key = categoryId.replace(/\s+/g, '');
    key = key.charAt(0).toLowerCase() + key.slice(1);
    return strings[key] || categoryId;
}

function openProductDetail(item) {
    _currentDetailItem = item;
    const lang = localStorage.getItem('selectedLang') || 'ku';
    const name = item[`name_${lang}`] || item.name_en || item.name_ar || item.name_ku || 'Unnamed Item';
    const description = item[`description_${lang}`] || item.description_en || item.description_ar || item.description_ku || '';
    const fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%231a1a1a width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2740%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23D4AF37%27%3E%E2%98%95%3C/text%3E%3C/svg%3E';
    const imageUrl = normalizeImageUrl(item.image) || fallbackImage;

    // Populate detail panel
    const imgEl = document.getElementById('detailImage');
    if (imgEl) imgEl.src = imageUrl;

    const catEl = document.getElementById('detailCategory');
    if (catEl) catEl.textContent = getCategoryDisplayName(item.category, lang);

    const titleEl = document.getElementById('detailTitle');
    if (titleEl) titleEl.textContent = name;

    const descEl = document.getElementById('detailDesc');
    if (descEl) descEl.textContent = description;

    const priceEl = document.getElementById('detailPrice');
    if (priceEl) priceEl.textContent = item.price ? Number(item.price).toLocaleString() : '0';

    // Sizes & Scoops handling (Matching Screenshot 2: Clean luxury rows "IQD 2,000 ... ١ سکۆپ")
    var sizesWrap = document.getElementById('detailSizesWrap');
    var sizesList = document.getElementById('detailSizesList');
    var singlePriceWrap = document.getElementById('detailSinglePriceWrap');
    var sizesTitleText = document.getElementById('detailSizesTitleText');

    if (sizesTitleText) {
        var chooseTitles = {
            ku: 'هەڵبژێرە',
            ar: 'اختر الحجم',
            en: 'Choose Size'
        };
        sizesTitleText.textContent = chooseTitles[lang] || chooseTitles.ku;
    }

    if (item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0) {
        if (sizesWrap) sizesWrap.style.display = 'block';
        if (singlePriceWrap) singlePriceWrap.style.display = 'none';
        if (sizesList) {
            sizesList.innerHTML = '';
            item.sizes.forEach(function (sz, idx) {
                var szName = sz['name_' + lang] || sz.name_ku || sz.name_ar || sz.name_en || ('Option ' + (idx + 1));
                var rowEl = document.createElement('div');
                rowEl.className = 'detail-size-row' + (idx === 0 ? ' active' : '');
                rowEl.setAttribute('role', 'button');
                rowEl.setAttribute('tabindex', '0');
                rowEl.innerHTML =
                    '<span class="detail-size-name">' + String(szName || '') + '</span>' +
                    '<span class="detail-size-price">IQD ' + Number(sz.price || 0).toLocaleString() + '</span>';
                rowEl.addEventListener('click', function () {
                    sizesList.querySelectorAll('.detail-size-row').forEach(function (r) { r.classList.remove('active'); });
                    rowEl.classList.add('active');
                    window._selectedDetailSize = sz;
                    syncDetailPriceAndButton();
                });
                sizesList.appendChild(rowEl);
            });
            window._selectedDetailSize = item.sizes[0];
        }
    } else {
        window._selectedDetailSize = null;
        if (sizesWrap) sizesWrap.style.display = 'none';
        if (singlePriceWrap) {
            singlePriceWrap.style.display = 'flex';
            if (priceEl) {
                priceEl.textContent = 'IQD ' + (item.price ? Number(item.price).toLocaleString() : '0');
            }
        }
    }

    // Modal Add-to-Cart Stepper & Action
    var _detailQuantity = 1;
    function syncDetailPriceAndButton() {
        var unitPrice = 0;
        if (window._selectedDetailSize && window._selectedDetailSize.price) {
            unitPrice = parseItemPrice(window._selectedDetailSize.price);
        } else {
            unitPrice = parseItemPrice(item.price);
        }
        var total = unitPrice * _detailQuantity;
        var btnPrice = document.getElementById('detailBtnPrice');
        if (btnPrice) {
            btnPrice.textContent = (total > 0 ? total.toLocaleString() : '0') + ' IQD';
        }
        var qtyVal = document.getElementById('detailQtyVal');
        if (qtyVal) {
            qtyVal.textContent = _detailQuantity;
        }
    }

    var minusBtn = document.getElementById('detailQtyMinus');
    var plusBtn = document.getElementById('detailQtyPlus');
    var addCartBtn = document.getElementById('detailAddToCartBtn');
    var addCartText = document.getElementById('detailAddToCartText');

    if (addCartText) {
        var addTextMap = {
            ku: 'زیادکردن بۆ سەبەتە',
            ar: 'إضافة للسلة',
            en: 'Add to Cart'
        };
        addCartText.textContent = addTextMap[lang] || addTextMap.ku;
    }

    if (minusBtn) {
        minusBtn.onclick = function (e) {
            e.stopPropagation();
            if (_detailQuantity > 1) {
                _detailQuantity--;
                syncDetailPriceAndButton();
            }
        };
    }

    if (plusBtn) {
        plusBtn.onclick = function (e) {
            e.stopPropagation();
            _detailQuantity++;
            syncDetailPriceAndButton();
        };
    }

    if (addCartBtn) {
        addCartBtn.onclick = function (e) {
            e.stopPropagation();
            addToCart(item, {
                size: window._selectedDetailSize,
                quantity: _detailQuantity
            });
            closeProductDetail();
        };
    }

    syncDetailPriceAndButton();

    // Video button
    const videoBtn = document.getElementById('videoPlayBtn');
    if (videoBtn) {
        if (item.video) {
            videoBtn.style.display = 'flex';
            videoBtn.onclick = () => openVideoModal(item.video);
        } else {
            videoBtn.style.display = 'none';
        }
    }

    // Show overlay
    const overlay = document.getElementById('detailOverlay');
    if (overlay) {
        if (overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
        }
        overlay.classList.add('open');
        document.body.classList.add('detail-open');
        lockPageScroll();
        overlay.scrollTop = 0;
    }
}

function closeProductDetail() {
    const overlay = document.getElementById('detailOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        document.body.classList.remove('detail-open');
        unlockPageScroll();
    }
    _currentDetailItem = null;
    window._selectedDetailSize = null;
}

/* ========================================
   Video Modal
   ======================================== */

function openVideoModal(videoUrl) {
    const overlay = document.getElementById('videoOverlay');
    const videoEl = document.getElementById('detailVideo');
    if (!overlay || !videoEl) return;

    videoEl.src = videoEl.src = videoUrl;
    videoEl.play().catch(() => {});
    overlay.classList.add('open');
}

function closeVideoModal() {
    const overlay = document.getElementById('videoOverlay');
    const videoEl = document.getElementById('detailVideo');
    if (overlay) overlay.classList.remove('open');
    if (videoEl) {
        videoEl.pause();
        videoEl.src = '';
    }
}

/* ========================================
   Event Wiring (menu page)
   ======================================== */

document.addEventListener('DOMContentLoaded', function () {
    // Initialize cart
    loadCart();
    updateCartBadge();

    // Initialize language dropdown
    var currentLang = localStorage.getItem('selectedLang') || 'ku';
    var currentLangLabel = document.getElementById('currentLangLabel');
    if (currentLangLabel) {
        currentLangLabel.textContent = currentLang.toUpperCase();
    }
    document.querySelectorAll('.lang-option').forEach(function(option) {
        option.classList.toggle('active', option.getAttribute('data-lang') === currentLang);
    });

    // Cart button
    var cartBtn = document.getElementById('cartBtn');
    if (cartBtn) {
        cartBtn.addEventListener('click', openCartPanel);
    }

    var cartClose = document.getElementById('cartClose');
    if (cartClose) {
        cartClose.addEventListener('click', closeCartPanel);
    }

    var cartOverlay = document.getElementById('cartOverlay');
    if (cartOverlay) {
        cartOverlay.addEventListener('click', function(e) {
            if (e.target === cartOverlay) closeCartPanel();
        });
    }

    // Favorites button + panel
    updateFavBadge();
    var favBtn = document.getElementById('favBtn');
    if (favBtn) {
        favBtn.addEventListener('click', openFavPanel);
    }
    var favClose = document.getElementById('favClose');
    if (favClose) {
        favClose.addEventListener('click', closeFavPanel);
    }
    var favOverlay = document.getElementById('favOverlay');
    if (favOverlay) {
        favOverlay.addEventListener('click', function (e) {
            if (e.target === favOverlay || (e.target && e.target.id === 'favBackdrop')) closeFavPanel();
        });
    }

    window.addEventListener('hashchange', function () {
        if (location.hash === '#fav' || location.hash === '#favorites') {
            openFavPanel();
        }
    });
    if (location.hash === '#fav' || location.hash === '#favorites') {
        setTimeout(openFavPanel, 350);
    }

    var cartClear = document.getElementById('cartClear');
    if (cartClear) {
        cartClear.addEventListener('click', function() {
            clearCart();
            renderCartItems();
        });
    }

    var cartWhatsapp = document.getElementById('cartWhatsapp');
    if (cartWhatsapp) {
        cartWhatsapp.addEventListener('click', function() {
            sendWhatsAppOrder();
        });
    }

    var cartLocationBtn = document.getElementById('cartLocationBtn');
    if (cartLocationBtn) {
        cartLocationBtn.addEventListener('click', function() {
            useCurrentLocation();
        });
    }

    setupCartFormValidation();

    setupCafeInfoPanel();

    // Layout toggle: Grid ↔ List (every category heading has a button)
    (function setupLayoutToggle() {
        var btn = document.getElementById('layoutToggleBtn');
        var grid = document.getElementById('menuGrid');
        var textEl = document.getElementById('layoutText');
        var iconEl = document.getElementById('layoutIcon');
        if (!grid) return;

        function applyLayout(mode) {
            var isList = mode === 'list';
            grid.classList.toggle('layout-vertical', isList);
            grid.classList.toggle('layout-horizontal', !isList);
            document.body.classList.toggle('menu-layout-list', isList);
            document.body.classList.toggle('menu-layout-grid', !isList);
            if (textEl) textEl.textContent = isList ? 'List' : 'Grid';
            var iconHtml = isList ? MENU_LAYOUT_LIST_ICON : MENU_LAYOUT_GRID_ICON;
            if (iconEl) iconEl.innerHTML = iconHtml;
            syncSectionLayoutIcons(mode);
            try { localStorage.setItem('menuLayoutMode', mode); } catch (e) {}
        }

        window.applyMenuLayoutMode = applyLayout;

        var saved = 'grid';
        try {
            if (!localStorage.getItem('menuLayoutGridV2Migrated')) {
                localStorage.setItem('menuLayoutMode', 'grid');
                localStorage.setItem('menuLayoutGridV2Migrated', '1');
            }
            saved = localStorage.getItem('menuLayoutMode') || 'grid';
        } catch (e) {}
        applyLayout(saved === 'list' ? 'list' : 'grid');

        function toggleLayout(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            var next = grid.classList.contains('layout-vertical') ? 'grid' : 'list';
            applyLayout(next);
        }

        if (btn) btn.addEventListener('click', toggleLayout);
        document.addEventListener('click', function (e) {
            var sectionIcon = e.target && e.target.closest ? e.target.closest('.section-layout-icon') : null;
            if (!sectionIcon) return;
            toggleLayout(e);
        });
    })();

    // Detail close
    var detailBackdrop = document.getElementById('detailBackdrop');
    var detailClose = document.getElementById('detailClose');
    if (detailBackdrop) detailBackdrop.addEventListener('click', closeProductDetail);
    if (detailClose) detailClose.addEventListener('click', closeProductDetail);

    // Video close
    var videoOverlay = document.getElementById('videoOverlay');
    var videoClose = document.getElementById('videoClose');
    if (videoOverlay) videoOverlay.addEventListener('click', function (e) { if (e.target === this) closeVideoModal(); });
    if (videoClose) videoClose.addEventListener('click', closeVideoModal);

    // Escape key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var videoOverlay = document.getElementById('videoOverlay');
            if (videoOverlay && videoOverlay.classList.contains('open')) {
                closeVideoModal();
            } else {
                closeInstallTutorial();
                closeCafeInfoPanel();
                closeProductDetail();
                closeFavPanel();
                closeCartPanel();
            }
        }
    });
});

/* ========================================
   Language
   ======================================== */

function setActiveLanguage(lang) {
    try { sessionStorage.setItem('selectedLang', lang); } catch (e) {}
    localStorage.setItem('selectedLang', lang);

    if (window.location.pathname.includes('menu.html')) {
        const url = new URL(window.location);
        url.searchParams.set('lang', lang);
        window.history.pushState({ path: url.href }, '', url.href);
    }

    // Update old buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });

    // Update new dropdown
    var currentLangLabel = document.getElementById('currentLangLabel');
    if (currentLangLabel) {
        currentLangLabel.textContent = lang.toUpperCase();
    }

    document.querySelectorAll('.lang-option').forEach(function(option) {
        option.classList.toggle('active', option.getAttribute('data-lang') === lang);
    });

    document.documentElement.dir = (lang === 'ar' || lang === 'ku') ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    if (document.body) {
        document.body.setAttribute('data-lang', lang);
        document.body.classList.remove('is-lang-ku', 'is-lang-ar', 'is-lang-en');
        document.body.classList.add('is-lang-' + lang);
    }
}

function applyLanguageUI(lang) {
    document.documentElement.dir = (lang === 'ar' || lang === 'ku') ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    if (document.body) {
        document.body.setAttribute('data-lang', lang);
        document.body.classList.remove('is-lang-ku', 'is-lang-ar', 'is-lang-en');
        document.body.classList.add('is-lang-' + lang);
    }
    var strings = i18n[lang] || i18n.en;
    document.title = strings.pageTitle;

    document.querySelectorAll('[data-i18n]').forEach(function (element) {
        if (element.closest('#menuHeroBrand')) return;
        if (element.id === 'cafeHoursText') return;
        var key = element.getAttribute('data-i18n');
        if (strings[key]) element.textContent = strings[key];
    });

    if (window.location.pathname.includes('admin.html')) {
        updateAdminPanelText(strings);
        var activeSection = document.querySelector('.admin-nav-btn.active');
        if (activeSection) {
            var section = activeSection.getAttribute('data-section');
            loadAdminSection(section);
        }
    }

    if (cachedMenuItems.length > 0) {
        renderCategories(cachedMenuItems, { forceRebuild: true, autoSelect: false });
        var targetCat = _activeCategory || ALL_CATEGORY_ID;
        renderMenuItems(filterItemsByCategory(cachedMenuItems, targetCat));
        renderMenuCardsWithFeatures();
        if (window._observeCategorySections) window._observeCategorySections();
        setCategoryPillActive(targetCat);
    }

    if (window.jumpHeroTitleToLang) {
        window.jumpHeroTitleToLang(lang);
    }

    if (_currentDetailItem) {
        openProductDetail(_currentDetailItem);
    }

    updateCafeInfoPanel();
    updateInstallHelpLabel();

    var searchInput = document.getElementById('headerSearchInput');
    if (searchInput) {
        searchInput.placeholder = strings.searchPlaceholder || strings.searchItems || 'Search menu...';
    }

    var overlayInput = document.getElementById('searchOverlayInput');
    if (overlayInput) {
        var searchPlaceholders = {
            ku: 'گەڕان بکە',
            ar: 'ابحث هنا...',
            en: 'Search menu...'
        };
        overlayInput.placeholder = searchPlaceholders[lang] || strings.searchPlaceholder || 'Search menu...';
    }

    var searchOverlay = document.getElementById('searchOverlayView');
    if (searchOverlay) {
        var isRtlSearch = (lang === 'ku' || lang === 'ar');
        searchOverlay.setAttribute('dir', isRtlSearch ? 'rtl' : 'ltr');
        if (!searchOverlay.hidden && typeof renderSearchOverlayItems === 'function') {
            renderSearchOverlayItems(overlayInput ? overlayInput.value : '');
        }
    }

    var searchModalWrap = document.getElementById('searchPreviewModalWrap');
    if (searchModalWrap && !searchModalWrap.hidden && window._currentSearchPreviewItem && typeof openSearchItemPreview === 'function') {
        openSearchItemPreview(window._currentSearchPreviewItem);
    }
}

function updateAdminPanelText(strings) {
    var navMap = {
        dashboard: strings.dashboard,
        items: strings.manageItems,
        categories: strings.manageCategories,
        offers: strings.manageOffers,
        reviews: strings.manageReviews,
        testmenu: strings.manageTestMenu,
        subscriptions: strings.manageSubscription || 'بەشداری و مۆڵەت (SmartServe)',
        superadmin: strings.superAdmin || 'سوپەر ئەدمین (SmartServe)',
        cashier: strings.cashier,
        expenses: strings.expenses,
        settings: strings.settings,
        logout: strings.logout
    };
    var superAdminLink = document.getElementById('adminSuperAdminLink');
    if (superAdminLink) {
        var saLabel = superAdminLink.querySelector('span:last-child');
        if (saLabel && strings.superAdmin) saLabel.textContent = strings.superAdmin;
    }
    var activeBtn = document.querySelector('.admin-nav-btn.active');
    var adminHeader = document.querySelector('.admin-header h1');
    if (adminHeader && activeBtn) {
        var activeSection = activeBtn.getAttribute('data-section');
        if (navMap[activeSection]) adminHeader.textContent = navMap[activeSection];
    }
    document.querySelectorAll('.admin-nav-btn').forEach(function (item) {
        var section = item.getAttribute('data-section');
        if (navMap[section]) {
            var label = item.querySelector('span:last-child');
            if (label) label.textContent = navMap[section];
        }
    });
}

function setupLanguageButtons() {
    var langDropdownBtn = document.getElementById('langDropdownBtn');
    var langDropdownMenu = document.getElementById('langDropdownMenu');
    var langDropdown = document.getElementById('langDropdown');
    var currentLangLabel = document.getElementById('currentLangLabel');

    if (langDropdownBtn && langDropdownMenu && langDropdown) {
        langDropdownBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var themeDropdown = document.getElementById('themeDropdown');
            if (themeDropdown) themeDropdown.classList.remove('open');
            closeHeaderSearch();
            closeThemeMenu();
            var willOpen = !langDropdown.classList.contains('open');
            if (willOpen) {
                langDropdown.classList.add('open');
                langDropdownBtn.setAttribute('aria-expanded', 'true');
                positionLangMenu();
                requestAnimationFrame(function () {
                    positionLangMenu();
                });
            } else {
                closeLangMenu();
            }
        });

        langDropdownMenu.querySelectorAll('.lang-option').forEach(function (option) {
            option.addEventListener('click', function (e) {
                e.stopPropagation();
                var lang = this.getAttribute('data-lang');
                setActiveLanguage(lang);
                applyLanguageUI(lang);
                closeLangMenu();
                if (currentLangLabel) {
                    currentLangLabel.textContent = lang.toUpperCase();
                }
            });
        });

        langDropdownMenu.addEventListener('click', function (e) {
            e.stopPropagation();
        });

        document.addEventListener('click', function (e) {
            if (!langDropdown.classList.contains('open')) return;
            var menu = document.getElementById('langDropdownMenu');
            if (langDropdown.contains(e.target)) return;
            if (menu && menu.contains(e.target)) return;
            closeLangMenu();
        });

        window.addEventListener('resize', function () {
            if (langDropdown.classList.contains('open')) positionLangMenu();
        }, { passive: true });

        window.addEventListener('scroll', function () {
            if (langDropdown.classList.contains('open')) positionLangMenu();
        }, { passive: true });
    }

    document.querySelectorAll('.lang-btn').forEach(function (button) {
        button.addEventListener('click', function () {
            var lang = button.getAttribute('data-lang');
            setActiveLanguage(lang);
            applyLanguageUI(lang);
        });
    });

    setupHeaderSearch();
}

function positionLangMenu() {
    var btn = document.getElementById('langDropdownBtn');
    var menu = document.getElementById('langDropdownMenu');
    var dropdown = document.getElementById('langDropdown');
    if (!btn || !menu) return;

    if (menu.parentElement !== document.body) {
        menu._langHome = menu.parentElement;
        document.body.appendChild(menu);
    }

    menu.classList.add('lang-menu-portal', 'fab-lang-menu', 'lang-dropdown-menu');
    var isOpen = !!(dropdown && dropdown.classList.contains('open'));
    menu.classList.toggle('is-open', isOpen);

    var rect = btn.getBoundingClientRect();
    var margin = 12;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var isMobile = vw <= 640;
    var menuWidth = isMobile ? Math.min(188, vw - margin * 2) : Math.min(200, vw - margin * 2);

    // Prefer align to button's end (works for KU on the right)
    var left = rect.right - menuWidth;
    if (left < margin) left = margin;
    if (left + menuWidth > vw - margin) left = vw - menuWidth - margin;

    var top = rect.bottom + 8;
    // Temporarily show to measure height if needed
    menu.style.setProperty('visibility', 'hidden', 'important');
    menu.style.setProperty('opacity', '0', 'important');
    menu.style.setProperty('pointer-events', 'none', 'important');
    menu.style.setProperty('display', 'block', 'important');
    menu.style.setProperty('position', 'fixed', 'important');
    menu.style.setProperty('width', menuWidth + 'px', 'important');
    var menuHeight = menu.offsetHeight || 160;
    if (top + menuHeight > vh - margin) {
        top = Math.max(margin, rect.top - menuHeight - 8);
    }

    menu.style.setProperty('top', Math.round(top) + 'px', 'important');
    menu.style.setProperty('left', Math.round(left) + 'px', 'important');
    menu.style.setProperty('right', 'auto', 'important');
    menu.style.setProperty('bottom', 'auto', 'important');
    menu.style.setProperty('transform', 'none', 'important');
    menu.style.setProperty('margin', '0', 'important');
    menu.style.setProperty('z-index', '2147483000', 'important');
    menu.style.setProperty('max-width', (vw - margin * 2) + 'px', 'important');

    if (isOpen) {
        menu.style.setProperty('opacity', '1', 'important');
        menu.style.setProperty('visibility', 'visible', 'important');
        menu.style.setProperty('pointer-events', 'auto', 'important');
    } else {
        menu.style.setProperty('opacity', '0', 'important');
        menu.style.setProperty('visibility', 'hidden', 'important');
        menu.style.setProperty('pointer-events', 'none', 'important');
    }
}

function closeLangMenu() {
    var dropdown = document.getElementById('langDropdown');
    var btn = document.getElementById('langDropdownBtn');
    var menu = document.getElementById('langDropdownMenu');
    if (dropdown) dropdown.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (menu) {
        menu.classList.remove('is-open');
        menu.style.setProperty('opacity', '0', 'important');
        menu.style.setProperty('visibility', 'hidden', 'important');
        menu.style.setProperty('pointer-events', 'none', 'important');
    }
}

function openSearchOverlay() {
    var overlay = document.getElementById('searchOverlayView');
    if (!overlay) return;

    if (typeof closeLangMenu === 'function') closeLangMenu();
    var themeDropdown = document.getElementById('themeDropdown');
    if (themeDropdown) themeDropdown.classList.remove('open');

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var isRtl = (lang === 'ku' || lang === 'ar');
    overlay.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    document.body.classList.add('search-overlay-open');
    overlay.hidden = false;

    var input = document.getElementById('searchOverlayInput');
    var clearBtn = document.getElementById('searchOverlayClear');
    if (input) {
        var placeholders = {
            ku: 'گەڕان بکە',
            ar: 'ابحث هنا...',
            en: 'Search menu...'
        };
        input.placeholder = placeholders[lang] || placeholders.ku;
        input.value = '';
        if (clearBtn) clearBtn.hidden = true;
        setTimeout(function () { input.focus(); }, 60);
    }

    renderSearchOverlayItems('');
}

function closeSearchOverlay() {
    closeSearchItemPreview();
    var overlay = document.getElementById('searchOverlayView');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('search-overlay-open');
    var btn = document.getElementById('headerSearchBtn');
    if (btn) btn.classList.remove('is-active');
}

function closeHeaderSearch() {
    closeSearchOverlay();
    var panel = document.getElementById('headerSearchPanel');
    var btn = document.getElementById('headerSearchBtn');
    if (panel) panel.hidden = true;
    if (btn) btn.classList.remove('is-active');
}

function openSearchItemPreview(item) {
    if (!item) return;
    window._currentSearchPreviewItem = item;
    var modalWrap = document.getElementById('searchPreviewModalWrap');
    var imgEl = document.getElementById('searchPreviewImage');
    var nameEl = document.getElementById('searchPreviewName');
    var priceEl = document.getElementById('searchPreviewPrice');
    if (!modalWrap) return;

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var name = item['name_' + lang] || item.name_en || item.name_ar || item.name_ku || item.name || 'Unnamed Item';
    var fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%231a1a1a width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2740%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23D4AF37%27%3E%E2%98%95%3C/text%3E%3C/svg%3E';
    var imageUrl = (typeof normalizeImageUrl === 'function' ? normalizeImageUrl(item.image) : item.image) || fallbackImage;

    var priceNum = Number(item.price) || 0;
    if ((!priceNum || priceNum === 0) && item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0) {
        priceNum = Number(item.sizes[0].price) || 0;
    }
    // Screenshot 2 format: clean formatted price like "7,500"
    var priceText = priceNum ? priceNum.toLocaleString() : '0';

    if (imgEl) {
        imgEl.src = imageUrl;
        imgEl.alt = name;
        imgEl.onerror = function () { this.onerror = null; this.src = fallbackImage; };
    }
    if (nameEl) nameEl.textContent = name;
    if (priceEl) priceEl.textContent = priceText;

    modalWrap.hidden = false;
}

function closeSearchItemPreview() {
    window._currentSearchPreviewItem = null;
    var modalWrap = document.getElementById('searchPreviewModalWrap');
    if (modalWrap) modalWrap.hidden = true;
}

function renderSearchOverlayItems(query) {
    var container = document.getElementById('searchOverlayItems');
    var emptyEl = document.getElementById('searchOverlayEmpty');
    var emptyTextEl = document.getElementById('searchEmptyText');
    if (!container) return;

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var allItems = (window.MenuData && typeof MenuData.getItems === 'function')
        ? (MenuData.getItems() || [])
        : (cachedMenuItems || []);

    var q = String(query || '').toLowerCase().trim();
    var filtered = allItems;
    if (q) {
        filtered = allItems.filter(function (item) {
            var nKu = String(item.name_ku || '').toLowerCase();
            var nAr = String(item.name_ar || '').toLowerCase();
            var nEn = String(item.name_en || '').toLowerCase();
            var nDef = String(item.name || '').toLowerCase();
            var cat = String(item.category || '').toLowerCase();
            var desc = String(item.description || item.description_ku || item.description_ar || item.description_en || '').toLowerCase();
            return nKu.indexOf(q) !== -1 ||
                   nAr.indexOf(q) !== -1 ||
                   nEn.indexOf(q) !== -1 ||
                   nDef.indexOf(q) !== -1 ||
                   cat.indexOf(q) !== -1 ||
                   desc.indexOf(q) !== -1;
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        if (emptyTextEl) {
            var emptyMsgs = {
                ku: 'هیچ ئایتمێک نەدۆزرایەوە',
                ar: 'لم يتم العثور على أي عنصر',
                en: 'No items found'
            };
            emptyTextEl.textContent = emptyMsgs[lang] || emptyMsgs.ku;
        }
        return;
    }

    if (emptyEl) emptyEl.hidden = true;

    var html = '';
    filtered.forEach(function (item) {
        var name = item['name_' + lang] || item.name_en || item.name_ar || item.name_ku || item.name || 'Unnamed Item';
        var priceNum = Number(item.price) || 0;
        var priceDisplay = '';

        if (item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0) {
            var validPrices = item.sizes.map(function(s) { return Number(s.price) || 0; }).filter(function(p) { return p > 0; });
            if (validPrices.length > 0) {
                var minP = Math.min.apply(null, validPrices);
                var maxP = Math.max.apply(null, validPrices);
                if (minP !== maxP) {
                    priceDisplay = 'IQD ' + minP.toLocaleString() + ' - ' + maxP.toLocaleString();
                } else {
                    priceDisplay = 'IQD ' + minP.toLocaleString();
                }
            }
        }
        if (!priceDisplay) {
            priceDisplay = 'IQD ' + (priceNum ? priceNum.toLocaleString() : '0');
        }

        var safeName = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += '<div class="search-overlay-row" data-item-id="' + item.id + '" role="button" tabindex="0">' +
                    '<span class="search-row-title">' + safeName + '</span>' +
                    '<span class="search-row-price">' + priceDisplay + '</span>' +
                '</div>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.search-overlay-row').forEach(function (row) {
        row.addEventListener('click', function () {
            var id = row.getAttribute('data-item-id');
            var found = allItems.find(function (i) { return String(i.id) === String(id); });
            if (found) {
                openSearchItemPreview(found);
            }
        });
        row.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                row.click();
            }
        });
    });
}

function setupHeaderSearch() {
    var btn = document.getElementById('headerSearchBtn');
    if (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openSearchOverlay();
        });
    }

    var backBtn = document.getElementById('searchOverlayBack');
    if (backBtn) {
        backBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            closeSearchOverlay();
        });
    }

    var searchInput = document.getElementById('searchOverlayInput');
    var clearBtn = document.getElementById('searchOverlayClear');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            var q = searchInput.value.trim();
            if (clearBtn) clearBtn.hidden = !q;
            renderSearchOverlayItems(q);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (searchInput) {
                searchInput.value = '';
                clearBtn.hidden = true;
                renderSearchOverlayItems('');
                searchInput.focus();
            }
        });
    }

    var previewCloseBtn = document.getElementById('searchPreviewClose');
    if (previewCloseBtn) {
        previewCloseBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            closeSearchItemPreview();
        });
    }

    var previewBackdrop = document.getElementById('searchPreviewBackdrop');
    if (previewBackdrop) {
        previewBackdrop.addEventListener('click', function (e) {
            e.stopPropagation();
            closeSearchItemPreview();
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var previewWrap = document.getElementById('searchPreviewModalWrap');
            if (previewWrap && !previewWrap.hidden) {
                closeSearchItemPreview();
                return;
            }
            var searchOverlay = document.getElementById('searchOverlayView');
            if (searchOverlay && !searchOverlay.hidden) {
                closeSearchOverlay();
            }
        }
    });
}

function applyMenuSearch(query) {
    var q = String(query || '').toLowerCase().trim();
    var cards = document.querySelectorAll('#menuGrid .menu-card');
    var sections = document.querySelectorAll('#menuGrid .category-section');
    var visibleCount = 0;

    cards.forEach(function (card) {
        var titleEl = card.querySelector('.menu-card-foot-title, .menu-card-title');
        var title = titleEl ? titleEl.textContent : '';
        var match = !q || title.toLowerCase().indexOf(q) !== -1;
        card.style.display = match ? '' : 'none';
        if (match) visibleCount += 1;
    });

    sections.forEach(function (section) {
        var anyVisible = Array.prototype.some.call(section.querySelectorAll('.menu-card'), function (card) {
            return card.style.display !== 'none';
        });
        section.style.display = (!q || anyVisible) ? '' : 'none';
    });

    var empty = document.getElementById('menuSearchEmpty');
    var grid = document.getElementById('menuGrid');
    if (!grid) return;

    if (q && visibleCount === 0) {
        if (!empty) {
            empty = document.createElement('div');
            empty.id = 'menuSearchEmpty';
            empty.className = 'menu-search-empty';
            grid.appendChild(empty);
        }
        var strings = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
        empty.textContent = strings.noResults || strings.emptyMenu || 'No items found';
        empty.hidden = false;
    } else if (empty) {
        empty.hidden = true;
    }
}

/* ========================================
   Theme
   ======================================== */

function isAdminAppUi() {
    return !!(document.getElementById('adminContent') || document.querySelector('.admin-layout'));
}

function setupOfflineDetection() {
    registerServiceWorker();
    setupMenuAutoRefresh();

    window.addEventListener('online', function () {
        isOffline = false;
        if (!isAdminAppUi()) {
            scheduleMenuConnectionStatus(true);
        }
        console.log('Back online');
        if (document.getElementById('menuGrid')) {
            loadMenuItems._inProgress = false;
            loadMenuItems();
        }
    });

    window.addEventListener('offline', function () {
        isOffline = true;
        if (!isAdminAppUi()) {
            scheduleMenuConnectionStatus(false);
        }
        console.log('Gone offline');
    });

    if (isAdminAppUi()) return;

    isOffline = !navigator.onLine;
    if (isOffline) scheduleMenuConnectionStatus(false);
}

function setupMenuAutoRefresh() {
    if (!document.getElementById('menuGrid')) return;

    var lastRefreshMs = 0;
    var MIN_GAP_MS = 5000;

    function refreshMenuFromCloud() {
        if (!navigator.onLine) return;
        var now = Date.now();
        if (now - lastRefreshMs < MIN_GAP_MS) return;
        lastRefreshMs = now;

        fetchMenuViaRest(12000).then(function (items) {
            applyMenuItemsUpdate(items, { background: true });
        }).catch(function () {});

        loadCategoriesFromFirebase().then(function (categoriesChanged) {
            if (categoriesChanged && cachedMenuItems.length > 0) {
                renderCategories(cachedMenuItems, { autoSelect: false, forceRebuild: true });
            }
        }).catch(function () {});
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') refreshMenuFromCloud();
    });
    window.addEventListener('focus', refreshMenuFromCloud);
    window.addEventListener('pageshow', function (event) {
        if (event.persisted) refreshMenuFromCloud();
    });
}

var _menuStatusShowTimer = null;
var _menuStatusHideTimer = null;
var MENU_STATUS_DELAY_MS = 2000;
var MENU_STATUS_VISIBLE_MS = 3000;

function clearMenuStatusTimers() {
    if (_menuStatusShowTimer) { clearTimeout(_menuStatusShowTimer); _menuStatusShowTimer = null; }
    if (_menuStatusHideTimer) { clearTimeout(_menuStatusHideTimer); _menuStatusHideTimer = null; }
}

function hideMenuConnectionStatus() {
    var existing = document.getElementById('offlineIndicator');
    if (!existing) return;
    existing.style.opacity = '0';
    setTimeout(function () { if (existing.parentNode) existing.remove(); }, 400);
}

function scheduleMenuConnectionStatus(online) {
    clearMenuStatusTimers();
    hideMenuConnectionStatus();
    _menuStatusShowTimer = setTimeout(function () {
        _menuStatusShowTimer = null;
        showMenuConnectionStatusNow(online);
        _menuStatusHideTimer = setTimeout(function () {
            _menuStatusHideTimer = null;
            hideMenuConnectionStatus();
        }, MENU_STATUS_VISIBLE_MS);
    }, MENU_STATUS_DELAY_MS);
}

function showMenuConnectionStatusNow(online) {
    var existing = document.getElementById('offlineIndicator');
    if (existing) existing.remove();
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;
    var indicator = document.createElement('div');
    indicator.id = 'offlineIndicator';
    indicator.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);color:white;padding:8px 16px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity .4s ease;';
    indicator.textContent = online ? (S.backOnline || 'Back online — syncing') : S.offlineMode;
    indicator.style.background = online ? '#2E7D32' : '#C62828';
    document.body.appendChild(indicator);
}

function updateOfflineIndicator() {
    scheduleMenuConnectionStatus(!isOffline);
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    const adminThemeToggle = document.getElementById('adminThemeToggle');

    if (document.body.classList.contains('emenu-layout')) {
        setupMenuThemePicker();
        return;
    }

    // Index landing must stay dark so video/splash never flash white from a saved light theme.
    if (document.body.classList.contains('index-page')) {
        document.body.classList.remove('light-mode');
        return;
    }

    const savedTheme = localStorage.getItem('theme') || 'dark';

    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }

    const handleToggle = () => {
        const isLight = document.body.classList.toggle('light-mode');
        const newTheme = isLight ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
    };

    if (themeToggle) themeToggle.addEventListener('click', handleToggle);
    if (adminThemeToggle) adminThemeToggle.addEventListener('click', handleToggle);
}

var MENU_THEMES = window.MENU_THEMES || {
    forest:   { id: 'forest',   light: false, meta: '#0A1C12', brown: '#3ECF8E', price: '#E8C56A', muted: '#9BB9AA', bg: '#0A1C12', sticky: '#0A1C12', action: '#143528', surface: '#1A4030', card: '#163E2B', card2: '#245A45', cat: '#143528', pill: '#143528', fab: '#1A4030', text: '#F4FFF9', border: 'rgba(62,207,142,0.16)', fabText: '#F4FFF9', modalBg: '#0F2C1D' },
    midnight: { id: 'midnight', light: false, meta: '#060B14', brown: '#60A5FA', price: '#FBBF24', muted: '#8FA3BF', bg: '#060B14', sticky: '#060B14', action: '#121F33', surface: '#182840', card: '#14253D', card2: '#23405F', cat: '#121F33', pill: '#121F33', fab: '#182840', text: '#EAF2FF', border: 'rgba(96,165,250,0.16)', fabText: '#EAF2FF', modalBg: '#0E1B2E' },
    rose:     { id: 'rose',     light: false, meta: '#120A0E', brown: '#FB7185', price: '#FCD34D', muted: '#C9A0A9', bg: '#120A0E', sticky: '#120A0E', action: '#2E1820', surface: '#3A1F2A', card: '#3A1B28', card2: '#563040', cat: '#2E1820', pill: '#2E1820', fab: '#3A1F2A', text: '#FFF1F4', border: 'rgba(251,113,133,0.16)', fabText: '#FFF1F4', modalBg: '#26111B' },
    gold:     { id: 'gold',     light: false, meta: '#0E0B06', brown: '#F2C659', price: '#F2C659', muted: '#B9A67A', bg: '#0E0B06', sticky: '#0E0B06', action: '#241C10', surface: '#2E2414', card: '#352410', card2: '#45361C', cat: '#241C10', pill: '#241C10', fab: '#2E2414', text: '#FFF8E7', border: 'rgba(242,198,89,0.18)', fabText: '#FFF8E7', modalBg: '#24180A' },
    olive:    { id: 'olive',    light: false, meta: '#10160C', brown: '#B8C26A', price: '#E4D48A', muted: '#A3A88F', bg: '#10160C', sticky: '#10160C', action: '#1A2414', surface: '#222E1A', card: '#26341C', card2: '#334428', cat: '#1A2414', pill: '#1A2414', fab: '#222E1A', text: '#F4F7EC', border: 'rgba(184,194,106,0.16)', fabText: '#F4F7EC', modalBg: '#1A2413' },
    cream:    { id: 'cream',    light: true,  meta: '#E4D4A4', brown: '#B8891E', price: '#9E6B08', muted: '#7A6438', bg: '#E4D4A4', sticky: '#E4D4A4', action: '#D8C68E', surface: '#E2D29E', card: '#FFFFFF', card2: '#F4ECD2', cat: '#CEBA7C', pill: '#D8C68E', fab: '#DC9C72', text: '#2C220E', border: 'rgba(184,137,30,0.22)', fabText: '#2C220E', modalBg: '#FAF6EA' },
    mocha:    { id: 'mocha',    light: true,  meta: '#EFE4DA', brown: '#5C4033', price: '#A05212', muted: '#6B5446', bg: '#EFE4DA', sticky: '#EFE4DA', action: '#E6D7C8', surface: '#EDE1D5', card: '#FAF5EF', card2: '#F4EAE1', cat: '#E2D4C5', pill: '#EADECF', fab: '#E6D7C8', text: '#2A1810', border: 'rgba(92,64,51,0.18)', fabText: '#2A1810', modalBg: '#FAF5EF' },
    dark:     { id: 'dark',     light: false, meta: '#090909', brown: '#C4956A', price: '#E2C08A', muted: '#9A9590', bg: '#090909', sticky: '#090909', action: '#171717', surface: '#1F1F1F', card: '#222222', card2: '#323232', cat: '#171717', pill: '#171717', fab: '#1F1F1F', text: '#F0F0F0', border: 'rgba(255,255,255,0.1)', fabText: '#CFCFCF', modalBg: '#151515' }
};

function emenuBrownRing(hex, alpha) {
    if (window.emenuBrownRing) return window.emenuBrownRing(hex, alpha);
    alpha = alpha == null ? 0.22 : alpha;
    if (!hex || hex.charAt(0) !== '#') return 'rgba(155,97,53,' + alpha + ')';
    var h = hex.slice(1);
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function applyMenuTheme(themeId) {
    if (window.MENU_THEMES) MENU_THEMES = window.MENU_THEMES;
    if (!MENU_THEMES[themeId]) themeId = 'midnight';
    var theme = MENU_THEMES[themeId];
    theme.id = themeId;
    var body = document.body;

    if (window.applyEmenuThemeCssVars) {
        window.applyEmenuThemeCssVars(body, theme);
    } else {
        body.setAttribute('data-menu-theme', themeId);
        body.classList.toggle('light-mode', theme.light);
        body.style.setProperty('--emenu-brown', theme.brown);
        body.style.setProperty('--emenu-accent', theme.brown);
        body.style.setProperty('--heading-accent', theme.brown);
        body.style.setProperty('--heading-fg', theme.brown);
        body.style.setProperty('--emenu-bg', theme.bg);
        body.style.setProperty('--emenu-cat-bg', theme.cat);
        body.style.setProperty('--emenu-card-bg', theme.card);
        body.style.setProperty('--emenu-modal-bg', theme.modalBg || theme.card || '#3A1F15');
        body.style.setProperty('--emenu-surface', theme.surface);
        body.style.setProperty('--emenu-pill-bg', theme.pill);
        body.style.setProperty('--emenu-fab-bg', theme.fab);
        body.style.setProperty('--emenu-text', theme.text);
        body.style.setProperty('--emenu-border', theme.border);
        body.style.setProperty('--emenu-fab-text', theme.fabText);
        body.style.setProperty('--emenu-curve', theme.bg);
        body.style.setProperty('--emenu-price', theme.price || theme.brown);
        body.style.setProperty('--emenu-muted', theme.muted || '#A9C2B5');
        body.style.setProperty('--emenu-sticky', theme.sticky || theme.bg);
        body.style.setProperty('--emenu-action', theme.action || theme.surface);
        body.style.setProperty('--bg', theme.bg);
        body.style.setProperty('--bg-card', theme.card);
        body.style.setProperty('--color-bg', theme.bg);
        body.style.setProperty('--text-primary', theme.text);
        body.style.setProperty('--color-text', theme.text);
        body.style.setProperty('--color-text-secondary', theme.muted || (theme.light ? '#6B5446' : '#A9C2B5'));
        body.style.setProperty('--color-text-muted', theme.muted || (theme.light ? '#8C7565' : '#8FA3BF'));
        body.style.setProperty('--color-surface', theme.card || '#FFFFFF');
        body.style.setProperty('--color-surface-2', theme.card2 || '#F7F0E8');
        body.style.setProperty('--color-border', theme.border);
        body.style.backgroundColor = theme.bg;
    }

    body.classList.add('theme-switching');
    setTimeout(function () { body.classList.remove('theme-switching'); }, 450);

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.meta || theme.bg);

    document.querySelectorAll('.theme-option').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-theme') === themeId);
    });

    var preview = document.getElementById('themeBtnPreview');
    if (preview) {
        preview.style.background = 'linear-gradient(135deg, ' + theme.brown + ', ' + (theme.price || theme.brown) + ')';
    }

    try {
        sessionStorage.setItem('menuTheme', themeId);
        localStorage.setItem('menuTheme', themeId);
    } catch (e) {}

    // Keep language pill + header cart/search synced with theme
    var langBtn = document.getElementById('langDropdownBtn');
    if (langBtn) {
        langBtn.style.setProperty('background', theme.action || theme.surface, 'important');
        langBtn.style.setProperty('border-color', theme.border, 'important');
        langBtn.style.setProperty('color', theme.text, 'important');
        langBtn.querySelectorAll('.lang-pill-globe, .lang-pill-sep').forEach(function (el) {
            el.style.setProperty('color', theme.brown, 'important');
        });
        var code = langBtn.querySelector('.lang-pill-code');
        if (code) code.style.setProperty('color', theme.text, 'important');
        var chev = langBtn.querySelector('.lang-pill-chevron');
        if (chev) chev.style.setProperty('color', theme.muted || theme.text, 'important');
    }
    ['cartBtn', 'headerSearchBtn', 'favBtn', 'cafeInfoBtn', 'themeDropdownBtn'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.style.setProperty('background', theme.action || theme.surface, 'important');
        el.style.setProperty('border-color', theme.border, 'important');
        el.style.setProperty('color', theme.text, 'important');
    });
    var heroTitle = document.getElementById('heroTitleTyped');
    if (heroTitle) {
        heroTitle.style.setProperty('color', theme.text, 'important');
    }
    var heroCursor = document.getElementById('heroTitleCursor');
    if (heroCursor) {
        heroCursor.style.setProperty('background', theme.brown, 'important');
    }
    var layoutBtn = document.getElementById('layoutToggleBtn');
    if (layoutBtn) {
        layoutBtn.style.setProperty('background', theme.action || theme.surface, 'important');
        layoutBtn.style.setProperty('border-color', theme.border, 'important');
        layoutBtn.style.setProperty('color', theme.text, 'important');
    }
}

function positionThemeMenu() {
    var btn = document.getElementById('themeDropdownBtn');
    var menu = document.getElementById('themeDropdownMenu');
    var dropdown = document.getElementById('themeDropdown');
    if (!btn || !menu) return;

    if (menu.parentElement !== document.body) {
        menu._themeHome = menu.parentElement;
        document.body.appendChild(menu);
    }

    menu.classList.add('theme-menu-portal');
    var isOpen = !!(dropdown && dropdown.classList.contains('open'));
    menu.classList.toggle('is-open', isOpen);

    var rect = btn.getBoundingClientRect();
    var margin = 12;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var menuWidth = Math.min(320, vw - margin * 2);
    var left = rect.left + (rect.width / 2) - (menuWidth / 2);
    if (left < margin) left = margin;
    if (left + menuWidth > vw - margin) left = vw - menuWidth - margin;

    menu.style.setProperty('display', 'block', 'important');
    menu.style.setProperty('position', 'fixed', 'important');
    menu.style.setProperty('width', menuWidth + 'px', 'important');
    menu.style.setProperty('max-width', (vw - margin * 2) + 'px', 'important');
    menu.style.setProperty('max-height', (vh - margin * 2) + 'px', 'important');
    menu.style.setProperty('overflow-y', 'auto', 'important');
    menu.style.setProperty('z-index', '2147483000', 'important');
    menu.style.setProperty('transform', 'none', 'important');
    menu.style.setProperty('bottom', 'auto', 'important');
    menu.style.setProperty('right', 'auto', 'important');

    // Measure after width is applied
    var menuHeight = Math.min(menu.scrollHeight || menu.offsetHeight || 360, vh - margin * 2);
    var top = rect.bottom + 10;
    if (top + menuHeight > vh - margin) {
        top = Math.max(margin, rect.top - menuHeight - 10);
    }

    menu.style.setProperty('top', Math.round(top) + 'px', 'important');
    menu.style.setProperty('left', Math.round(left) + 'px', 'important');

    if (isOpen) {
        menu.style.setProperty('opacity', '1', 'important');
        menu.style.setProperty('visibility', 'visible', 'important');
        menu.style.setProperty('pointer-events', 'auto', 'important');
    } else {
        menu.style.setProperty('opacity', '0', 'important');
        menu.style.setProperty('visibility', 'hidden', 'important');
        menu.style.setProperty('pointer-events', 'none', 'important');
    }
}

function closeThemeMenu() {
    var dropdown = document.getElementById('themeDropdown');
    var btn = document.getElementById('themeDropdownBtn');
    var menu = document.getElementById('themeDropdownMenu');
    if (dropdown) dropdown.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (menu) {
        menu.classList.remove('is-open');
        menu.style.setProperty('opacity', '0', 'important');
        menu.style.setProperty('visibility', 'hidden', 'important');
        menu.style.setProperty('pointer-events', 'none', 'important');
    }
}

function setupMenuThemePicker() {
    if (window.MENU_THEMES) MENU_THEMES = window.MENU_THEMES;
    var urlTheme = (new URLSearchParams(window.location.search || '')).get('theme');
    var sessionTheme = null;
    try { sessionTheme = sessionStorage.getItem('menuTheme'); } catch (e) {}
    // Default brand theme is ALWAYS Midnight Dark for all customers on open!
    var saved = urlTheme || sessionTheme || 'midnight';
    if (!saved || !MENU_THEMES[saved]) saved = 'midnight';
    try { localStorage.setItem('menuTheme', saved); } catch (e) {}
    applyMenuTheme(saved);

    var themeDropdown = document.getElementById('themeDropdown');
    var themeDropdownBtn = document.getElementById('themeDropdownBtn');
    var themeDropdownMenu = document.getElementById('themeDropdownMenu');

    if (themeDropdownBtn && themeDropdownMenu && themeDropdown) {
        themeDropdownBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            closeLangMenu();
            closeHeaderSearch();
            var willOpen = !themeDropdown.classList.contains('open');
            if (willOpen) {
                themeDropdown.classList.add('open');
                themeDropdownBtn.setAttribute('aria-expanded', 'true');
                positionThemeMenu();
                requestAnimationFrame(function () {
                    positionThemeMenu();
                    setTimeout(positionThemeMenu, 50);
                });
            } else {
                closeThemeMenu();
            }
        });

        themeDropdownMenu.querySelectorAll('.theme-option').forEach(function (option) {
            option.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                applyMenuTheme(this.getAttribute('data-theme'));
                closeThemeMenu();
            });
        });

        themeDropdownMenu.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    document.addEventListener('click', function (e) {
        if (!themeDropdown || !themeDropdown.classList.contains('open')) return;
        var menu = document.getElementById('themeDropdownMenu');
        if (themeDropdown.contains(e.target)) return;
        if (menu && menu.contains(e.target)) return;
        if (themeDropdownBtn && themeDropdownBtn.contains(e.target)) return;
        closeThemeMenu();
    });

    document.addEventListener('touchend', function (e) {
        if (!themeDropdown || !themeDropdown.classList.contains('open')) return;
        var menu = document.getElementById('themeDropdownMenu');
        if (themeDropdown.contains(e.target)) return;
        if (menu && menu.contains(e.target)) return;
        if (themeDropdownBtn && themeDropdownBtn.contains(e.target)) return;
        closeThemeMenu();
    }, { passive: true });

    window.addEventListener('resize', function () {
        if (themeDropdown && themeDropdown.classList.contains('open')) positionThemeMenu();
    }, { passive: true });

    window.addEventListener('scroll', function () {
        if (themeDropdown && themeDropdown.classList.contains('open')) positionThemeMenu();
    }, { passive: true });
}

var HERO_TYPE_PHRASES = [
    { text: 'بریو کافێ', dir: 'rtl', lang: 'ku' },
    { text: 'بریو کوفي', dir: 'rtl', lang: 'ar' },
    { text: 'BREW CAFE & REST', dir: 'ltr', lang: 'en' }
];

function heroTypeChars(str) {
    return Array.from(str);
}

function initHeroTitleSequence() {
    var typewriter = document.getElementById('heroTypewriter');
    var typedEl = document.getElementById('heroTitleTyped');
    if (!typewriter || !typedEl) return;

    stopHeroTitleLoop();

    var phraseIndex = 0;
    var charIndex = 0;
    var isDeleting = false;
    var isIndexPage = document.body.classList.contains('index-page');
    var isMenuPage = document.body.classList.contains('menu-page');
    var chars = heroTypeChars(HERO_TYPE_PHRASES[0].text);

    function typeDelay() {
        if (isDeleting) {
            return (isIndexPage ? 75 : 32) + Math.random() * (isIndexPage ? 45 : 22);
        }
        return (isIndexPage ? 120 : 58) + Math.random() * (isIndexPage ? 90 : 40);
    }

    function pauseDelay() {
        return isDeleting
            ? (isIndexPage ? 450 : 280)
            : (isIndexPage ? 2600 : (isMenuPage ? 2200 : 2000));
    }

    function applyPhraseMeta() {
        var phrase = HERO_TYPE_PHRASES[phraseIndex];
        typewriter.setAttribute('dir', phrase.dir);
        typedEl.setAttribute('dir', phrase.dir);
        if (phrase.lang) typedEl.setAttribute('lang', phrase.lang);
        else typedEl.removeAttribute('lang');

        if (phrase.lang === 'ku') {
            typewriter.classList.add('is-rtl-title');
            typewriter.classList.remove('is-ltr-title');
            typewriter.style.fontFamily = 'var(--font-ku, "Vazirmatn", "Noto Sans Arabic", "Noto Kufi Arabic", sans-serif)';
            typedEl.style.fontFamily = 'var(--font-ku, "Vazirmatn", "Noto Sans Arabic", "Noto Kufi Arabic", sans-serif)';
            typewriter.style.letterSpacing = '0';
            typedEl.style.letterSpacing = '0';
        } else if (phrase.dir === 'rtl') {
            typewriter.classList.add('is-rtl-title');
            typewriter.classList.remove('is-ltr-title');
            typewriter.style.fontFamily = 'var(--font-ar, "Cairo", "Tajawal", sans-serif)';
            typedEl.style.fontFamily = 'var(--font-ar, "Cairo", "Tajawal", sans-serif)';
            typewriter.style.letterSpacing = '0';
            typedEl.style.letterSpacing = '0';
        } else {
            typewriter.classList.add('is-ltr-title');
            typewriter.classList.remove('is-rtl-title');
            typewriter.style.fontFamily = 'var(--font-en, "Inter", "Poppins", sans-serif)';
            typedEl.style.fontFamily = 'var(--font-en, "Inter", "Poppins", sans-serif)';
            typewriter.style.letterSpacing = '0.04em';
            typedEl.style.letterSpacing = '0.04em';
        }
    }

    window.jumpHeroTitleToLang = function (lang) {
        if (!Array.isArray(HERO_TYPE_PHRASES)) return;
        var idx = -1;
        for (var i = 0; i < HERO_TYPE_PHRASES.length; i++) {
            if (HERO_TYPE_PHRASES[i].lang === lang) {
                idx = i;
                break;
            }
        }
        if (idx !== -1) {
            phraseIndex = idx;
            charIndex = 0;
            isDeleting = false;
            if (initHeroTitleSequence._timeout) clearTimeout(initHeroTitleSequence._timeout);
            tick();
        }
    };

    function tick() {
        var phrase = HERO_TYPE_PHRASES[phraseIndex];
        chars = heroTypeChars(phrase.text);
        applyPhraseMeta();

        if (!isDeleting) {
            charIndex += 1;
            typedEl.textContent = chars.slice(0, charIndex).join('');

            if (charIndex >= chars.length) {
                initHeroTitleSequence._timeout = setTimeout(function () {
                    isDeleting = true;
                    tick();
                }, pauseDelay());
                return;
            }
        } else {
            charIndex -= 1;
            typedEl.textContent = chars.slice(0, charIndex).join('');

            if (charIndex <= 0) {
                isDeleting = false;
                phraseIndex = (phraseIndex + 1) % HERO_TYPE_PHRASES.length;
                initHeroTitleSequence._timeout = setTimeout(tick, pauseDelay());
                return;
            }
        }

        initHeroTitleSequence._timeout = setTimeout(tick, typeDelay());
    }

    typedEl.textContent = '';
    applyPhraseMeta();
    initHeroTitleSequence._timeout = setTimeout(tick, 400);
}

function stopHeroTitleLoop() {
    if (initHeroTitleSequence._timeout) {
        clearTimeout(initHeroTitleSequence._timeout);
        initHeroTitleSequence._timeout = null;
    }
}

/* ========================================
    Cart Functions
    ======================================== */

function loadCart() {
    try {
        cartItems = JSON.parse(localStorage.getItem('cart_items') || '[]');
    } catch(e) {
        cartItems = [];
    }
}

function saveCart() {
    localStorage.setItem('cart_items', JSON.stringify(cartItems));
}

function parseItemPrice(p) {
    if (typeof p === 'number' && !isNaN(p)) return p;
    if (!p) return 0;
    var clean = String(p).replace(/[^\d.]/g, '');
    var num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

function triggerCartBadgeBounce() {
    var badges = document.querySelectorAll('#cartBadge, .cart-badge');
    var cartBtns = document.querySelectorAll('#cartBtn, .header-cart-btn, .menu-fab-cart');
    badges.forEach(function (badge) {
        badge.classList.remove('cart-badge-bounce');
        void badge.offsetWidth;
        badge.classList.add('cart-badge-bounce');
    });
    cartBtns.forEach(function (btn) {
        btn.classList.remove('cart-badge-bounce');
        void btn.offsetWidth;
        btn.classList.add('cart-badge-bounce');
    });
}

function showAddToCartToast(name, price) {
    var toast = document.getElementById('cartToast');
    if (!toast) return;

    var titleEl = document.getElementById('cartToastTitle');
    var priceEl = document.getElementById('cartToastPrice');
    var lang = localStorage.getItem('selectedLang') || 'ku';

    var addedText = {
        ku: 'زیادکرا بۆ سەبەتە',
        ar: 'تمت الإضافة للسلة',
        en: 'Added to cart'
    };
    var label = addedText[lang] || addedText.ku;

    if (titleEl) titleEl.textContent = name;
    if (priceEl) priceEl.textContent = label + (price ? ' • ' + Number(price).toLocaleString() + ' IQD' : '');

    var actionBtn = document.getElementById('cartToastAction');
    if (actionBtn) {
        var cartLabel = {
            ku: 'سەبەتە 🛒',
            ar: 'السلة 🛒',
            en: 'View Cart 🛒'
        };
        actionBtn.textContent = cartLabel[lang] || cartLabel.ku;
        actionBtn.onclick = function (e) {
            e.stopPropagation();
            toast.classList.remove('show');
            openCartPanel();
        };
    }

    toast.classList.add('show');

    if (window._toastTimer) clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function () {
        toast.classList.remove('show');
    }, 3200);

    if (navigator && navigator.vibrate) {
        try { navigator.vibrate(35); } catch (e) {}
    }
}

function addToCart(item, options) {
    if (!item) return;
    options = options || {};
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var qty = Math.max(1, parseInt(options.quantity, 10) || 1);

    var hasSizes = item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0;
    var selectedSize = options.size || (hasSizes ? item.sizes[0] : null);

    var baseName = item['name_' + lang] || item.name_en || item.name_ar || item.name_ku || item.name || 'Item';
    var finalName = baseName;
    var finalPrice = parseItemPrice(item.price);
    var cartId = String(item.id || ('item_' + Date.now()));

    if (selectedSize) {
        var szName = selectedSize['name_' + lang] || selectedSize.name_ku || selectedSize.name_ar || selectedSize.name_en || selectedSize.name || '';
        if (szName) {
            finalName = baseName + ' (' + szName + ')';
        }
        if (selectedSize.price) {
            finalPrice = parseItemPrice(selectedSize.price);
        }
        var szId = selectedSize.id || szName || finalPrice;
        cartId = String(item.id || 'item') + '_' + String(szId).replace(/\s+/g, '_');
    }

    if (!Array.isArray(cartItems)) cartItems = [];

    var existing = cartItems.find(function(i) { return i.id === cartId; });
    if (existing) {
        existing.quantity += qty;
    } else {
        cartItems.push({
            id: cartId,
            itemId: item.id,
            name: finalName,
            price: finalPrice,
            image: normalizeImageUrl(item.image) || '',
            quantity: qty
        });
    }

    saveCart();
    updateCartBadge();
    showAddToCartToast(finalName, finalPrice);
    triggerCartBadgeBounce();
}
window.addToCart = addToCart;

// Global delegated capture listener so '+' buttons on cards always work 100% reliably
(function setupGlobalAddButtons() {
    var _lastClickTime = 0;
    document.addEventListener('click', function (e) {
        var addBtn = e.target && e.target.closest ? e.target.closest('.grid-add-btn, .menu-card-cart, .menu-card-add') : null;
        if (!addBtn) return;
        if (addBtn.id === 'detailAddToCartBtn' || addBtn.closest('#detailCartActionBar')) return;

        var cardEl = addBtn.closest('.menu-card');
        var itemId = addBtn.getAttribute('data-item-id') || (cardEl && cardEl.getAttribute('data-id'));
        if (!itemId) return;

        var now = Date.now();
        if (now - _lastClickTime < 300) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        _lastClickTime = now;

        e.preventDefault();
        e.stopPropagation();

        var item = findMenuItemById(itemId);
        if (!item) return;

        addBtn.classList.add('added');
        setTimeout(function () { addBtn.classList.remove('added'); }, 700);

        addToCart(item);
    }, true);
})();

function removeFromCart(itemId) {
    cartItems = cartItems.filter(function(i) { return i.id !== itemId; });
    saveCart();
    updateCartBadge();
}

function updateCartQuantity(itemId, delta) {
    var item = cartItems.find(function(i) { return i.id === itemId; });
    if (item) {
        item.quantity += delta;
        if (item.quantity <= 0) {
            removeFromCart(itemId);
        } else {
            saveCart();
        }
    }
    updateCartBadge();
}

function getCartTotal() {
    return cartItems.reduce(function(sum, i) { return sum + (i.price * i.quantity); }, 0);
}

function updateCartBadge() {
    var badges = document.querySelectorAll('#cartBadge, .cart-badge');
    var count = Array.isArray(cartItems) ? cartItems.reduce(function(sum, i) { return sum + (i.quantity || 1); }, 0) : 0;
    badges.forEach(function (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    });
}

function clearCart() {
    cartItems = [];
    saveCart();
    updateCartBadge();
}

function clearCartFormWarning() {
    var warning = document.getElementById('cartFormWarning');
    if (warning) {
        warning.textContent = '';
        warning.classList.add('hidden');
    }
    document.querySelectorAll('.cart-input.is-invalid').forEach(function (el) {
        el.classList.remove('is-invalid');
    });
}

function showCartFormWarning(message, focusEl, invalidEls) {
    var warning = document.getElementById('cartFormWarning');
    if (warning) {
        warning.textContent = message;
        warning.classList.remove('hidden');
    }
    document.querySelectorAll('.cart-input.is-invalid').forEach(function (el) {
        el.classList.remove('is-invalid');
    });
    (invalidEls || []).forEach(function (el) {
        if (el) el.classList.add('is-invalid');
    });
    if (focusEl) {
        focusEl.focus();
        focusEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function setupCartFormValidation() {
    ['customerName', 'customerPlace'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', clearCartFormWarning);
        }
    });
}

function getCartFormLabels(lang) {
    var labels = {
        ku: {
            needName: 'تکایە ناوی خۆت بنووسە پێش ناردن بە واتساپ',
            needPlace: 'تکایە شوێنەکەت بنووسە پێش ناردن بە واتساپ',
            needBoth: 'تکایە ناو و شوێن پڕبکەرەوە پێش ناردن بە واتساپ',
            needLocation: 'تکایە لۆکەیشنەکەت بنێرە پێش ناردن بە واتساپ',
            locationNotShared: 'لۆکەیشنەکەت نەنێردراوە'
        },
        ar: {
            needName: 'الرجاء إدخال اسمك قبل الإرسال عبر واتساب',
            needPlace: 'الرجاء إدخال موقعك قبل الإرسال عبر واتساب',
            needBoth: 'الرجاء إدخال الاسم والموقع قبل الإرسال عبر واتساب',
            needLocation: 'الرجاء إرسال موقعك قبل الإرسال عبر واتساب',
            locationNotShared: 'لم يتم مشاركة الموقع'
        },
        en: {
            needName: 'Please enter your name before sending via WhatsApp',
            needPlace: 'Please enter your location before sending via WhatsApp',
            needBoth: 'Please fill in name and location before sending via WhatsApp',
            needLocation: 'Please send your location before sending via WhatsApp',
            locationNotShared: 'Location not shared'
        }
    };
    return labels[lang] || labels.ku;
}

function sendWhatsAppOrder() {
    var id = localStorage.getItem('menuTheme') || 'midnight';
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var cafeInfo = getCafeInfo();
    var cafeName = cafeInfo.name;
    var phone = normalizeWhatsAppPhone(cafeInfo.phone);
    
    var nameEl = document.getElementById('customerName');
    var placeEl = document.getElementById('customerPlace');
    var customerName = nameEl ? nameEl.value.trim() : '';
    var customerPlace = placeEl ? placeEl.value.trim() : '';

    var formT = getCartFormLabels(lang);
    var labels = {
        ku: { order: 'داواکاری نوێ', name: 'ناو', place: 'شوێن', total: 'کۆی گشتی', time: 'کات' },
        ar: { order: 'طلب جديد', name: 'الاسم', place: 'الموقع', total: 'الإجمالي', time: 'الوقت' },
        en: { order: 'New Order', name: 'Name', place: 'Location', total: 'Total', time: 'Time' }
    };
    var T = labels[lang] || labels.en;

    if (!customerName && !customerPlace) {
        showCartFormWarning(formT.needBoth, nameEl, [nameEl, placeEl]);
        return;
    }

    if (!customerName) {
        showCartFormWarning(formT.needName, nameEl, [nameEl]);
        return;
    }

    if (!customerPlace) {
        showCartFormWarning(formT.needPlace, placeEl, [placeEl]);
        return;
    }

    var sendOrder = function() {
        clearCartFormWarning();

        var divider = '------------------------';
        var LRM_TIME = '\u200E';
        var lines = [];
        lines.push(T.time + ': ' + LRM_TIME + new Date().toLocaleString());
        lines.push(cafeName + ' - ' + T.order);
        lines.push(T.name + ': ' + customerName);
        lines.push(T.place + ': ' + customerPlace);
        if (window._customerLocationUrl) {
            lines.push('Maps: ' + window._customerLocationUrl);
        } else {
            lines.push(formT.locationNotShared || 'Location not shared');
        }
        lines.push(divider);

        var LRM = '\u200E';
        cartItems.forEach(function (item) {
            lines.push(item.name);
            var lineTotal = (item.price * item.quantity).toLocaleString();
            if (item.quantity > 1) {
                lines.push(LRM + item.quantity + ' x ' + item.price.toLocaleString() + ' = ' + lineTotal + ' IQD');
            } else {
                lines.push(LRM + lineTotal + ' IQD');
            }
        });

        lines.push(divider);
        lines.push(T.total + ': ' + LRM + getCartTotal().toLocaleString() + ' IQD');

        var message = lines.join('\n');

        var encoded = encodeURIComponent(message);
        var url = 'https://wa.me/' + phone + '?text=' + encoded;
        var opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
            window.location.href = url;
        }
    };

    var statusEl = document.getElementById('cartLocationStatus');
    
    // Always request location when sending via WhatsApp
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser. Please enter your location manually.');
        sendOrder();
        return;
    }

    statusEl.textContent = 'Getting your location...';
    statusEl.className = 'cart-location-status';
    statusEl.classList.remove('hidden');

    navigator.geolocation.getCurrentPosition(
        function (pos) {
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            window._customerLocationUrl = 'https://maps.google.com/?q=' + lat + ',' + lng;
            statusEl.textContent = 'Location captured ✓';
            statusEl.className = 'cart-location-status success';
            setTimeout(function() {
                statusEl.classList.add('hidden');
            }, 2000);
            sendOrder();
        },
        function (err) {
            window._customerLocationUrl = '';
            var errorMsg = 'Unable to get your location.';
            if (err.code === 1) {
                errorMsg = 'Location permission denied. Please enable location access or enter your location manually.';
            } else if (err.code === 2) {
                errorMsg = 'Unable to determine your location. Please enter your location manually.';
            } else if (err.code === 3) {
                errorMsg = 'Location request timed out. Please try again or enter your location manually.';
            }
            alert(errorMsg);
            statusEl.textContent = 'Location not captured';
            statusEl.className = 'cart-location-status error';
            setTimeout(function() {
                statusEl.classList.add('hidden');
            }, 3000);
            // Allow user to proceed without location
            sendOrder();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

/* ========================================
   Menu hero offers slideshow (replaces video)
   ======================================== */

var MENU_OFFERS_CACHE_KEY = 'cachedMenuOffers';
var MENU_OFFER_INTERVAL_MS = 3000;
var _menuOffersTimer = null;
var _menuOffersUnsub = null;
var _menuOffersIndex = 0;
var _menuOffersList = [];
var _menuOffersSwipeBound = false;
var _menuOffersSuppressClick = false;

function readCachedMenuOffers() {
    try {
        var list = JSON.parse(localStorage.getItem(MENU_OFFERS_CACHE_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function writeCachedMenuOffers(list) {
    try {
        localStorage.setItem(MENU_OFFERS_CACHE_KEY, JSON.stringify(list || []));
    } catch (e) { /* ignore quota */ }
}

function normalizeMenuOffer(doc) {
    if (!doc) return null;
    var data = doc.data && typeof doc.data === 'function' ? doc.data() : (doc.data || doc);
    var id = doc.id || data.id || '';
    var image = (data.image || '').trim();
    if (!image) return null;
    return {
        id: id,
        image: image,
        title: (data.title || '').trim(),
        linkUrl: (data.linkUrl || '').trim(),
        order: data.order != null ? Number(data.order) : 0,
        active: data.active !== false
    };
}

function sortMenuOffers(list) {
    return (list || []).slice().sort(function (a, b) {
        var ao = a.order != null ? Number(a.order) : 0;
        var bo = b.order != null ? Number(b.order) : 0;
        if (ao !== bo) return ao - bo;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

function getActiveMenuOffers(list) {
    return sortMenuOffers(list).filter(function (o) {
        return o && o.active !== false && o.image;
    });
}

function renderMenuOffersSlideshow(offers) {
    var track = document.getElementById('menuHeroOffersTrack');
    var dots = document.getElementById('menuHeroOffersDots');
    var hero = document.querySelector('.menu-hero');
    if (!track) return;

    _menuOffersList = getActiveMenuOffers(offers);
    _menuOffersIndex = 0;

    if (_menuOffersTimer) {
        clearInterval(_menuOffersTimer);
        _menuOffersTimer = null;
    }

    if (!_menuOffersList.length) {
        if (hero) hero.classList.remove('has-offers');
        track.innerHTML =
            '<div class="menu-hero-offer-slide is-active menu-hero-offer-fallback" data-offer-index="0" aria-hidden="false">' +
                '<div class="menu-hero-offer-fallback-bg"></div>' +
            '</div>';
        if (dots) {
            dots.innerHTML = '';
            dots.hidden = true;
        }
        return;
    }

    if (hero) hero.classList.add('has-offers');

    var slidesHtml = _menuOffersList.map(function (offer, index) {
        var linkAttr = offer.linkUrl
            ? ' data-link="' + String(offer.linkUrl).replace(/"/g, '&quot;') + '" role="link" tabindex="0"'
            : '';
        var clickable = offer.linkUrl ? ' is-clickable' : '';
        return '<div class="menu-hero-offer-slide' + (index === 0 ? ' is-active' : '') + clickable +
            '" data-offer-index="' + index + '"' + linkAttr + ' aria-hidden="' + (index === 0 ? 'false' : 'true') + '">' +
            '<img src="' + String(offer.image).replace(/"/g, '&quot;') + '" alt="' +
            String(offer.title || 'Offer').replace(/"/g, '&quot;') + '" class="menu-hero-offer-img" loading="' +
            (index === 0 ? 'eager' : 'lazy') + '">' +
            '</div>';
    }).join('');
    track.innerHTML = slidesHtml;

    if (dots) {
        if (_menuOffersList.length > 1) {
            dots.hidden = false;
            dots.innerHTML = _menuOffersList.map(function (_, index) {
                return '<button type="button" class="menu-hero-offer-dot' + (index === 0 ? ' is-active' : '') +
                    '" data-offer-dot="' + index + '" aria-label="Offer ' + (index + 1) + '"></button>';
            }).join('');
            dots.onclick = function (e) {
                var btn = e.target.closest('[data-offer-dot]');
                if (!btn) return;
                showMenuOfferSlide(parseInt(btn.getAttribute('data-offer-dot'), 10) || 0, true);
            };
        } else {
            dots.innerHTML = '';
            dots.hidden = true;
        }
    }

    track.onclick = function (e) {
        if (_menuOffersSuppressClick) {
            _menuOffersSuppressClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        var slide = e.target.closest('.menu-hero-offer-slide.is-clickable');
        if (!slide) return;
        var url = slide.getAttribute('data-link');
        if (url) window.open(url, '_blank', 'noopener');
    };

    wireMenuOffersSwipe();
    restartMenuOffersTimer();
}

function restartMenuOffersTimer() {
    if (_menuOffersTimer) {
        clearInterval(_menuOffersTimer);
        _menuOffersTimer = null;
    }
    if (_menuOffersList.length > 1) {
        _menuOffersTimer = setInterval(function () {
            if (document.hidden) return;
            showMenuOfferSlide(_menuOffersIndex + 1, false);
        }, MENU_OFFER_INTERVAL_MS);
    }
}

function wireMenuOffersSwipe() {
    var root = document.getElementById('menuHeroOffers');
    if (!root || _menuOffersSwipeBound) return;
    _menuOffersSwipeBound = true;

    var startX = 0;
    var startY = 0;
    var startTime = 0;
    var dragging = false;
    var swiped = false;

    function point(e) {
        if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function onStart(e) {
        if (_menuOffersList.length < 2) return;
        // Ignore swipe that starts on a dot button
        if (e.target && e.target.closest && e.target.closest('.menu-hero-offer-dot')) return;
        var p = point(e);
        startX = p.x;
        startY = p.y;
        startTime = Date.now();
        dragging = true;
        swiped = false;
    }

    function onMove(e) {
        if (!dragging) return;
        var p = point(e);
        var dx = p.x - startX;
        var dy = p.y - startY;
        // Lock to horizontal swipe once clearly sideways
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
            if (e.cancelable) e.preventDefault();
        }
    }

    function onEnd(e) {
        if (!dragging) return;
        dragging = false;
        if (_menuOffersList.length < 2) return;
        var p = point(e);
        var dx = p.x - startX;
        var dy = p.y - startY;
        var dt = Date.now() - startTime;
        var absX = Math.abs(dx);
        var absY = Math.abs(dy);
        // Swipe threshold: distance or quick flick
        if (absX > 40 && absX > absY * 1.1 && dt < 800) {
            swiped = true;
            _menuOffersSuppressClick = true;
            // RTL-friendly: swipe left = next, swipe right = previous (natural page feel)
            if (dx < 0) showMenuOfferSlide(_menuOffersIndex + 1, true);
            else showMenuOfferSlide(_menuOffersIndex - 1, true);
            setTimeout(function () { _menuOffersSuppressClick = false; }, 280);
        }
    }

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: true });
    root.addEventListener('mousedown', onStart);
    root.addEventListener('mousemove', onMove);
    root.addEventListener('mouseup', onEnd);
    root.addEventListener('mouseleave', function () { dragging = false; });
}

function showMenuOfferSlide(index, resetTimer) {
    if (!_menuOffersList.length) return;
    var track = document.getElementById('menuHeroOffersTrack');
    var dots = document.getElementById('menuHeroOffersDots');
    if (!track) return;

    var total = _menuOffersList.length;
    _menuOffersIndex = ((index % total) + total) % total;

    track.querySelectorAll('.menu-hero-offer-slide').forEach(function (slide) {
        var i = parseInt(slide.getAttribute('data-offer-index'), 10);
        var active = i === _menuOffersIndex;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if (dots) {
        dots.querySelectorAll('.menu-hero-offer-dot').forEach(function (dot) {
            var i = parseInt(dot.getAttribute('data-offer-dot'), 10);
            dot.classList.toggle('is-active', i === _menuOffersIndex);
        });
    }

    if (resetTimer) restartMenuOffersTimer();
}

function initMenuOffersSlideshow() {
    if (!document.getElementById('menuHeroOffersTrack')) return;

    renderMenuOffersSlideshow(readCachedMenuOffers());

    function applySnap(snap) {
        var list = [];
        snap.forEach(function (doc) {
            var offer = normalizeMenuOffer(doc);
            if (offer) list.push(offer);
        });
        writeCachedMenuOffers(list);
        renderMenuOffersSlideshow(list);
    }

    function loadViaRest() {
        if (typeof fetchPublicCollectionViaRest !== 'function' && typeof window.fetchPublicCollectionViaRest !== 'function') {
            // Admin helper may not exist on menu page — use inline REST.
            var cfg = window.firebaseConfig;
            if (!cfg || !cfg.projectId || !cfg.apiKey) return;
            var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) +
                '/databases/(default)/documents/menuOffers?pageSize=100&key=' + encodeURIComponent(cfg.apiKey);
            fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : Promise.reject(); })
                .then(function (json) {
                    var list = [];
                    (json.documents || []).forEach(function (doc) {
                        var parts = (doc.name || '').split('/');
                        var id = parts[parts.length - 1];
                        var fields = doc.fields || {};
                        var data = {};
                        Object.keys(fields).forEach(function (k) {
                            var f = fields[k];
                            if (!f) return;
                            if ('stringValue' in f) data[k] = f.stringValue;
                            else if ('integerValue' in f) data[k] = parseInt(f.integerValue, 10);
                            else if ('doubleValue' in f) data[k] = f.doubleValue;
                            else if ('booleanValue' in f) data[k] = f.booleanValue;
                        });
                        var offer = normalizeMenuOffer({ id: id, data: data });
                        if (offer) list.push(offer);
                    });
                    writeCachedMenuOffers(list);
                    renderMenuOffersSlideshow(list);
                }).catch(function () { /* keep cache/fallback */ });
            return;
        }
    }

    var start = function () {
        if (!window.db) {
            loadViaRest();
            return;
        }
        if (_menuOffersUnsub) {
            try { _menuOffersUnsub(); } catch (e) { /* ignore */ }
            _menuOffersUnsub = null;
        }
        var safety = setTimeout(function () {
            if (!_menuOffersList.length) loadViaRest();
        }, 5000);
        _menuOffersUnsub = onSnapshot(collection(db, 'menuOffers'), function (snap) {
            clearTimeout(safety);
            applySnap(snap);
        }, function (err) {
            clearTimeout(safety);
            console.warn('[offers] listener:', err && err.message);
            loadViaRest();
        });
    };

    if (window.dbReady) {
        Promise.resolve(window.dbReady).then(start).catch(start);
    } else {
        start();
    }
}

window.initMenuOffersSlideshow = initMenuOffersSlideshow;

/* ========================================
   Cafe Info Panel
   ======================================== */

var CAFE_SETTING_KEYS = [
    'cafeName',
    'cafeNameKu',
    'cafeNameAr',
    'cafeNameEn',
    'whatsappPhone',
    'cafeLocationUrl',
    'cafeLocationLabel',
    'cafeLocationLabelKu',
    'cafeLocationLabelAr',
    'cafeLocationLabelEn',
    'cafeOpenTime',
    'cafeCloseTime',
    'cafeInstagram',
    'cafeTiktok',
    'cafeSnapchat',
    'cafeFacebook'
];

/* ==========================================================================
   SMARTSERVE MULTI-RESTAURANT SUBSCRIPTION SYSTEM (Requirements 1 - 10)
   ========================================================================== */

function getMenuRestaurantId() {
    try {
        var params = new URLSearchParams(window.location.search || '');
        var r = (params.get('restaurant') || params.get('restaurantId') || params.get('r') || '').trim();
        if (r) return r.toLowerCase();
    } catch (e) {}
    if (window._currentRestaurantId) return String(window._currentRestaurantId).toLowerCase();
    return 'brew-coffee';
}
window.getMenuRestaurantId = getMenuRestaurantId;

var SMARTSERVE_EXPIRY_I18N = {
    en: {
        title: 'Menu Subscription Expired',
        lead: 'Please contact SmartServe to renew your menu.',
        contact: 'Contact SmartServe',
        badge: 'SMARTSERVE • DIGITAL MENU'
    },
    ku: {
        title: 'بەسەرچوونی ماوەی مێنیو',
        lead: 'تکایە بۆ نوێکردنەوەی مێنیوەکەت پەیوەندی بە SmartServe بکە.',
        contact: 'پەیوەندی بە SmartServe بکە',
        badge: 'سمارت سێرڤ • مێنیوی دیجیتاڵی'
    },
    ar: {
        title: 'انتهت صلاحية الاشتراك في القائمة',
        lead: 'يرجى التواصل مع SmartServe لتجديد القائمة.',
        contact: 'تواصل مع SmartServe',
        badge: 'سمارت سيرف • قائمة طعام رقمية'
    }
};

window._currentSubData = null;

function updateMenuExpiredOverlayText(lang, subData) {
    if (subData) window._currentSubData = subData;
    if (typeof window.renderMenuExpiredOverlay === 'function') {
        window.renderMenuExpiredOverlay(lang);
        return;
    }
    if (lang !== 'ku' && lang !== 'ar' && lang !== 'en') lang = 'ku';
    var strings = SMARTSERVE_EXPIRY_I18N[lang] || SMARTSERVE_EXPIRY_I18N.ku;
    var overlay = document.getElementById('menuExpiredOverlay');
    if (!overlay) return;

    var titleEl = document.getElementById('menuExpiredTitle');
    var leadEl = document.getElementById('menuExpiredLead');
    var ctaTextEl = document.getElementById('menuExpiredCtaText');
    var restNameEl = document.getElementById('menuExpiredRestName');

    if (titleEl) titleEl.textContent = strings.title;
    if (leadEl) leadEl.textContent = strings.lead;
    if (ctaTextEl) ctaTextEl.textContent = strings.contact;

    var badgeEl = overlay.querySelector('.menu-expired-badge');
    if (badgeEl && strings.badge) {
        badgeEl.textContent = strings.badge;
    }

    var isRtl = (lang === 'ku' || lang === 'ar');
    overlay.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    overlay.setAttribute('lang', lang);

    var rId = getMenuRestaurantId();
    var rName = (subData && subData.restaurantName) ||
                (window._currentSubData && window._currentSubData.restaurantName) ||
                localStorage.getItem('cafeName') ||
                'BREW CAFE & REST';
    if (restNameEl) {
        restNameEl.textContent = rName + ' (' + rId + ')';
    }

    // Set WhatsApp contact link with user's phone number: 0750 645 46 56 (9647506454656)
    var ctaBtn = document.getElementById('menuExpiredCtaBtn');
    if (ctaBtn) {
        var waPhone = '9647506454656';
        var waMsg = lang === 'ku'
            ? ('سڵاو SmartServe، دەمەوێت مۆڵەتی مێنیوی ' + rName + ' (' + rId + ') نوێ بکەمەوە.')
            : (lang === 'ar'
                ? ('مرحباً SmartServe، أود تجديد اشتراك قائمة ' + rName + ' (' + rId + ').')
                : ('Hello SmartServe, I want to renew the menu subscription for ' + rName + ' (' + rId + ').'));
        ctaBtn.href = 'https://wa.me/' + waPhone + '?text=' + encodeURIComponent(waMsg);
    }

    // Update active state on language pills
    overlay.querySelectorAll('.menu-expired-lang-pill').forEach(function (pill) {
        pill.classList.toggle('active', pill.getAttribute('data-lang') === lang);
    });
}

function enforceMenuExpiryState(isExpired, subData) {
    if (subData) window._currentSubData = subData;
    var overlay = document.getElementById('menuExpiredOverlay');
    if (!overlay) return isExpired;

    if (isExpired) {
        document.body.classList.add('menu-expired');
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        try {
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';
        } catch (e) {}
        var lang = localStorage.getItem('selectedLang') || 'ku';
        updateMenuExpiredOverlayText(lang, subData || window._currentSubData);
        return true;
    } else {
        document.body.classList.remove('menu-expired');
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        try {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        } catch (e) {}
        return false;
    }
}

function parseExpireTimestampMs(expiresAt) {
    if (!expiresAt) return 0;
    if (typeof expiresAt.toMillis === 'function') return expiresAt.toMillis();
    if (typeof expiresAt.toDate === 'function') return expiresAt.toDate().getTime();
    if (typeof expiresAt === 'number') return expiresAt;
    var parsed = Date.parse(expiresAt);
    return isNaN(parsed) ? 0 : parsed;
}

function getMenuLicenseExpireDate() {
    try { localStorage.removeItem('menuExpireDate'); } catch (e) { /* ignore */ }
    var license = window.MENU_LICENSE || {};
    return String(license.expireDate || '').trim();
}

function isMenuExpirePreviewRequested() {
    try {
        var params = new URLSearchParams(window.location.search || '');
        var flag = (params.get('expired') || params.get('preview') || '').toLowerCase();
        return flag === '1' || flag === 'true' || flag === 'expired' || flag === 'yes';
    } catch (e) {
        return false;
    }
}

function getMenuExpireEndMs(dateStr) {
    var raw = String(dateStr || '').trim();
    if (!raw) return null;
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
        var parsed = Date.parse(raw);
        return isNaN(parsed) ? null : parsed;
    }
    var end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
    return end.getTime();
}

window.getMenuLicenseExpireDate = getMenuLicenseExpireDate;
window.isMenuExpirePreviewRequested = isMenuExpirePreviewRequested;
window.getMenuExpireEndMs = getMenuExpireEndMs;

function checkRestaurantSubscription(restaurantId, callback) {
    if (isMenuExpirePreviewRequested()) {
        if (callback) callback({ expired: true, reason: 'preview' });
        return;
    }

    var rId = restaurantId || getMenuRestaurantId();

    if (USE_LOCAL_API) {
        localApiRequest('subscription.php?restaurant=' + encodeURIComponent(rId)).then(function (res) {
            var isExp = false;
            if (res && res.status === 'expired') isExp = true;
            else if (res && res.expires_at) {
                var expMs = parseExpireTimestampMs(res.expires_at);
                if (expMs > 0 && Date.now() > expMs) isExp = true;
            }
            if (callback) callback({ expired: isExp, data: res });
        }).catch(function (err) {
            // Requirement 10: safe error handling
            console.warn('[SmartServe] Local subscription check failed:', err && err.message);
            if (callback) callback({ expired: false, unverified: true });
        });
        return;
    }

    if (!window.db || typeof getDoc !== 'function' || typeof doc !== 'function') {
        // Requirement 10: If Firebase is not ready, do not incorrectly mark the menu as expired!
        if (callback) callback({ expired: false, unverified: true });
        return;
    }

    getDoc(doc(db, 'subscriptions', rId)).then(function (snap) {
        var exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
        if (!exists) {
            // Fallback for legacy configuration
            var legacyExpire = getMenuLicenseExpireDate();
            if (legacyExpire) {
                var endMs = getMenuExpireEndMs(legacyExpire);
                var isExp = endMs != null && Date.now() > endMs;
                if (callback) callback({ expired: isExp, data: null });
                return;
            }
            // Safe fallback: don't expire unconfigured menu
            if (callback) callback({ expired: false, data: null });
            return;
        }

        var data = snap.data() || {};
        var isExpired = false;
        var status = String(data.status || 'active').toLowerCase();
        if (status === 'expired' || status === 'disabled' || status === 'inactive') {
            isExpired = true;
        } else if (data.expiresAt) {
            var expMs = parseExpireTimestampMs(data.expiresAt);
            if (expMs > 0 && Date.now() > expMs) {
                isExpired = true;
            }
        }

        try {
            localStorage.setItem('smartserve_sub_' + rId, JSON.stringify({
                status: data.status || 'active',
                expiresAt: (data.expiresAt && data.expiresAt.toDate ? data.expiresAt.toDate().toISOString() : data.expiresAt) || '',
                verifiedAt: Date.now()
            }));
        } catch (e) {}

        if (callback) callback({ expired: isExpired, data: data });
    }).catch(function (err) {
        // Requirement 10: Handle Firebase loading errors safely. If subscription status cannot be verified, do not incorrectly mark the menu as expired!
        console.warn('[SmartServe] Subscription check error for ' + rId + ':', err && err.message);
        if (callback) callback({ expired: false, unverified: true, error: err });
    });
}

var _restaurantSubUnsubscribe = null;

function subscribeRestaurantSubscription(restaurantId) {
    var rId = restaurantId || getMenuRestaurantId();
    if (!window.db || typeof onSnapshot !== 'function' || typeof doc !== 'function') return;
    if (_restaurantSubUnsubscribe) {
        _restaurantSubUnsubscribe();
        _restaurantSubUnsubscribe = null;
    }

    _restaurantSubUnsubscribe = onSnapshot(doc(db, 'subscriptions', rId), function (snap) {
        var exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
        if (!exists) return;
        var data = snap.data() || {};
        var isExpired = false;
        var status = String(data.status || 'active').toLowerCase();
        if (status === 'expired' || status === 'disabled' || status === 'inactive') {
            isExpired = true;
        } else if (data.expiresAt) {
            var expMs = parseExpireTimestampMs(data.expiresAt);
            if (expMs > 0 && Date.now() > expMs) {
                isExpired = true;
            }
        }
        enforceMenuExpiryState(isExpired, data);
        if (!isExpired && document.getElementById('menuGrid') && (!window.cachedMenuItems || !window.cachedMenuItems.length)) {
            if (typeof loadMenuItems === 'function') loadMenuItems();
        }
    }, function (err) {
        console.warn('[SmartServe] Realtime subscription listener notice:', err && err.message);
    });
}

function initRestaurantSubscriptionSystem() {
    var rId = getMenuRestaurantId();

    // Wire language buttons on the expiration overlay
    document.addEventListener('click', function (e) {
        var pill = e.target && e.target.closest ? e.target.closest('.menu-expired-lang-pill') : null;
        if (!pill) return;
        var targetLang = pill.getAttribute('data-lang');
        if (targetLang) {
            localStorage.setItem('selectedLang', targetLang);
            if (typeof setActiveLanguage === 'function') setActiveLanguage(targetLang);
            if (typeof applyLanguageUI === 'function') applyLanguageUI(targetLang);
            updateMenuExpiredOverlayText(targetLang);
        }
    });

    // Check immediately and subscribe
    checkRestaurantSubscription(rId, function (res) {
        if (res && res.expired) {
            enforceMenuExpiryState(true, res.data);
        } else {
            enforceMenuExpiryState(false, res ? res.data : null);
        }
    });
    subscribeRestaurantSubscription(rId);
}

function isMenuExpired() {
    if (isMenuExpirePreviewRequested()) return true;
    var rId = getMenuRestaurantId();
    var cachedRaw = localStorage.getItem('smartserve_sub_' + rId);
    if (cachedRaw) {
        try {
            var cached = JSON.parse(cachedRaw);
            if (cached && cached.expiresAt) {
                var expMs = Date.parse(cached.expiresAt);
                if (!isNaN(expMs) && Date.now() > expMs) return true;
            }
        } catch (e) {}
    }
    var endMs = getMenuExpireEndMs(getMenuLicenseExpireDate());
    if (endMs == null) return false;
    return Date.now() > endMs;
}

function ensureMenuExpiredOverlay() {
    return document.getElementById('menuExpiredOverlay');
}

function enforceMenuExpiry() {
    if (!document.body || !document.body.classList.contains('menu-page')) return false;
    var expired = isMenuExpired();
    return enforceMenuExpiryState(expired, window._currentSubData);
}

window.isMenuExpired = isMenuExpired;
window.enforceMenuExpiry = enforceMenuExpiry;
window.enforceMenuExpiryState = enforceMenuExpiryState;
window.checkRestaurantSubscription = checkRestaurantSubscription;
window.subscribeRestaurantSubscription = subscribeRestaurantSubscription;
window.initRestaurantSubscriptionSystem = initRestaurantSubscriptionSystem;

function toLocaleDigits(value, lang) {
    var text = String(value);
    if (lang !== 'ku' && lang !== 'ar') return text;
    return text.replace(/\d/g, function (d) {
        return '٠١٢٣٤٥٦٧٨٩'[parseInt(d, 10)];
    });
}

function parseCafePeriodToPm(periodText) {
    var p = (periodText || '').trim().toLowerCase();
    if (!p) return null;
    if (/^p(?:m)?$/i.test(p) || p === 'م' || /مساء/.test(p) || /دوای\s*نیوەڕۆ|دواینیوەڕۆ/.test(p)) return true;
    if (/^a(?:m)?$/i.test(p) || p === 'ص' || /صباح/.test(p) || /بەیانی/.test(p)) return false;
    return null;
}

function normalizeCafeTimeValue(value, fallback) {
    fallback = fallback || '14:00';
    var raw = (value == null ? '' : String(value)).trim();
    if (!raw) return fallback;
    var normalizedRaw = raw
        .replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); })
        .replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); })
        .replace(/[\u200e\u200f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Mobile <input type="time"> often returns HH:MM:SS — keep minutes.
    normalizedRaw = normalizedRaw.replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');

    var matchPeriod = normalizedRaw.match(/^(\d{1,2})(?::(\d{2}))?\s*(.+)$/);
    if (matchPeriod) {
        var hourPart = parseInt(matchPeriod[1], 10);
        var minutePart = parseInt(matchPeriod[2] || '0', 10);
        var isPm = parseCafePeriodToPm(matchPeriod[3]);
        if (isPm !== null && !isNaN(hourPart) && hourPart >= 1 && hourPart <= 12 && !isNaN(minutePart) && minutePart >= 0 && minutePart <= 59) {
            var hour24Period = hourPart % 12;
            if (isPm) hour24Period += 12;
            return String(hour24Period).padStart(2, '0') + ':' + String(minutePart).padStart(2, '0');
        }
    }

    var match12 = normalizedRaw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp](?:[Mm])?|[صم])$/);
    if (match12) {
        var hour12 = parseInt(match12[1], 10);
        var minute12 = parseInt(match12[2] || '0', 10);
        var marker = String(match12[3] || '').toLowerCase();
        var isPmMarker = marker.indexOf('p') === 0 || marker === 'م';
        if (!isNaN(hour12) && hour12 >= 1 && hour12 <= 12 && !isNaN(minute12) && minute12 >= 0 && minute12 <= 59) {
            var hour24 = hour12 % 12;
            if (isPmMarker) hour24 += 12;
            return String(hour24).padStart(2, '0') + ':' + String(minute12).padStart(2, '0');
        }
    }

    var match = normalizedRaw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        var hourOnly = parseInt(normalizedRaw, 10);
        if (!isNaN(hourOnly) && hourOnly >= 0 && hourOnly <= 23) {
            return String(hourOnly).padStart(2, '0') + ':00';
        }
        return fallback;
    }

    var hour = parseInt(match[1], 10);
    var minute = parseInt(match[2], 10);
    if (isNaN(hour) || hour < 0 || hour > 23 || isNaN(minute) || minute < 0 || minute > 59) {
        return fallback;
    }
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function parseCafeTimeToMinutes(timeStr, fallbackHour) {
    var normalized = normalizeCafeTimeValue(timeStr, String(fallbackHour).padStart(2, '0') + ':00');
    var parts = normalized.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function formatCafeTimeForDisplay(timeStr, lang) {
    var normalized = normalizeCafeTimeValue(timeStr, '14:00');
    var parts = normalized.split(':');
    var hour24 = parseInt(parts[0], 10);
    var minute = parseInt(parts[1], 10);
    var hour12 = hour24 % 12 || 12;
    var minuteStr = String(minute).padStart(2, '0');
    var isPm = hour24 >= 12;

    var period = '';
    if (lang === 'ku') {
        period = isPm ? 'شەو' : 'بەیانی';
    } else if (lang === 'ar') {
        period = isPm ? 'مساءً' : 'صباحاً';
    } else {
        period = isPm ? 'PM' : 'AM';
    }

    if (lang === 'ku' || lang === 'ar') {
        var clock = toLocaleDigits(hour12, lang) + ':' + toLocaleDigits(minuteStr, lang);
        return clock + ' ' + period;
    }

    return hour12 + ':' + minuteStr + ' ' + period;
}

function formatCafeHoursDisplay(info, lang) {
    var strings = i18n[lang] || i18n.en;
    var open = formatCafeTimeForDisplay(info.openTime || '14:00', lang);
    var close = formatCafeTimeForDisplay(info.closeTime || '02:00', lang);
    return (strings.cafeHoursDaily || 'Daily') + ': ' + open + ' — ' + close;
}

function parseCafeTimeParts(timeStr, fallback) {
    fallback = fallback || '14:00';
    var normalized = normalizeCafeTimeValue(timeStr, fallback);
    var pieces = normalized.split(':');
    var hour24 = parseInt(pieces[0], 10);
    var minute = parseInt(pieces[1], 10);
    return {
        normalized: normalized,
        hour12: hour24 % 12 || 12,
        minute: minute,
        isPm: hour24 >= 12
    };
}

function buildCafeTimeFromParts(hour12, minute, isPm) {
    var h = parseInt(hour12, 10);
    var m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return '14:00';
    h = h % 12;
    if (isPm) h += 12;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function normalizeWhatsAppPhone(phone) {
    var digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '9647506454656';
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    if (digits.indexOf('964') === 0) return digits;
    if (digits.indexOf('0') === 0) return '964' + digits.slice(1);
    if (digits.length === 10) return '964' + digits;
    return digits;
}

function normalizeSocialUrl(url, platform) {
    url = (url || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.indexOf('//') === 0) return 'https:' + url;

    var cleaned = url.replace(/^@+/, '').replace(/\s+/g, '');
    if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(cleaned)) {
        return 'https://' + cleaned.replace(/^https?:\/\//i, '');
    }

    if (platform === 'instagram') {
        return 'https://instagram.com/' + cleaned.replace(/^instagram\.com\/?/i, '');
    }
    if (platform === 'tiktok') {
        return 'https://www.tiktok.com/@' + cleaned.replace(/^@+/, '').replace(/^tiktok\.com\/?@?/i, '');
    }
    if (platform === 'snapchat') {
        return 'https://www.snapchat.com/add/' + cleaned.replace(/^@+/, '').replace(/^snapchat\.com\/add\/?/i, '');
    }
    if (platform === 'facebook') {
        return 'https://www.facebook.com/' + cleaned.replace(/^@+/, '').replace(/^facebook\.com\/?/i, '');
    }

    return 'https://' + cleaned;
}

function getCafeSettingsCloudTimestamp(data) {
    if (!data || typeof data !== 'object') return 0;
    var cloudTs = parseInt(data.clientUpdatedAt, 10) || 0;
    try {
        if (data.updatedAt && typeof data.updatedAt.toMillis === 'function') {
            cloudTs = Math.max(cloudTs, data.updatedAt.toMillis());
        } else if (data.updatedAt && data.updatedAt.seconds != null) {
            cloudTs = Math.max(cloudTs, Number(data.updatedAt.seconds) * 1000);
        } else if (typeof data.updatedAt === 'number') {
            cloudTs = Math.max(cloudTs, data.updatedAt);
        }
    } catch (e) { /* ignore */ }
    return cloudTs;
}

function shouldApplyCafeSettingsFromCloud(data) {
    var localTs = parseInt(localStorage.getItem('cafeSettingsUpdatedAt') || '0', 10) || 0;
    if (!localTs) return true;
    var cloudTs = getCafeSettingsCloudTimestamp(data);
    // Prefer a fresh local save over a stale in-flight Firestore get().
    if (cloudTs && localTs > cloudTs) return false;
    if (!cloudTs && (Date.now() - localTs) < 15000) return false;
    return true;
}

function applyCafeSettingsToLocalStorage(data, options) {
    if (!data || typeof data !== 'object') return false;
    options = options || {};
    if (!options.force && !shouldApplyCafeSettingsFromCloud(data)) {
        return false;
    }
    CAFE_SETTING_KEYS.forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) return;
        var val = data[key];
        if (val == null || String(val).trim() === '') {
            localStorage.removeItem(key);
        } else {
            var stored = String(val).trim();
            if (key === 'cafeName') stored = normalizeCafeBrandName(stored);
            localStorage.setItem(key, stored);
        }
    });
    var cloudTs = getCafeSettingsCloudTimestamp(data);
    if (cloudTs) {
        try { localStorage.setItem('cafeSettingsUpdatedAt', String(cloudTs)); } catch (e) { /* ignore */ }
    }
    return true;
}

function getCafeSettingsFromLocalStorage() {
    var data = {};
    CAFE_SETTING_KEYS.forEach(function (key) {
        var value = localStorage.getItem(key);
        if (value != null && String(value).trim() !== '') {
            data[key] = String(value).trim();
        }
    });
    return data;
}

var cafeSettingsUnsubscribe = null;

function handleCafeSettingsStorageChange(event) {
    if (!event || !event.key) return;
    if (event.key === 'cafeSettingsUpdatedAt' || CAFE_SETTING_KEYS.indexOf(event.key) !== -1) {
        updateCafeInfoPanel();
        if (typeof enforceMenuExpiry === 'function') enforceMenuExpiry();
    }
}

window.addEventListener('storage', handleCafeSettingsStorageChange);

function loadCafeSettingsFromFirestore(callback) {
    if (USE_LOCAL_API) {
        localApiRequest('settings.php?id=cafe').then(function(doc) {
            if (doc && doc.data) {
                var data = typeof doc.data === 'string' ? JSON.parse(doc.data) : doc.data;
                applyCafeSettingsToLocalStorage(data);
            }
            if (callback) callback();
        }).catch(function(err) {
            console.warn('Could not load cafe settings:', err.message);
            if (callback) callback();
        });
        return;
    }
    
    if (!window.db) {
        if (callback) callback();
        return;
    }

    getDoc(doc(db, 'settings', 'cafe')).then(function (snap) {
        var exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
        if (exists) {
            applyCafeSettingsToLocalStorage(snap.data());
        }
        if (callback) callback(exists ? snap.data() : null);
    }).catch(function (err) {
        console.warn('Could not load cafe settings:', err.message);
        if (callback) callback(null);
    });
}

function subscribeCafeSettingsUpdates() {
    if (USE_LOCAL_API) {
        // For local API, we'll poll for changes every 5 seconds
        if (window._settingsPollInterval) {
            clearInterval(window._settingsPollInterval);
        }
        window._settingsPollInterval = setInterval(function() {
            if (!document.getElementById('menuGrid')) {
                clearInterval(window._settingsPollInterval);
                return;
            }
            localApiRequest('settings.php?id=cafe').then(function(doc) {
                if (doc && doc.data) {
                    var data = typeof doc.data === 'string' ? JSON.parse(doc.data) : doc.data;
                    applyCafeSettingsToLocalStorage(data);
                    updateCafeInfoPanel();
                }
            }).catch(function() {});
        }, 5000);
        return;
    }
    
    if (!window.db || !document.getElementById('menuGrid')) return;
    if (cafeSettingsUnsubscribe) {
        cafeSettingsUnsubscribe();
        cafeSettingsUnsubscribe = null;
    }

    cafeSettingsUnsubscribe = onSnapshot(doc(db, 'settings', 'cafe'), function (snap) {
        var exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
        if (exists) {
            if (applyCafeSettingsToLocalStorage(snap.data())) {
                updateCafeInfoPanel();
                if (typeof enforceMenuExpiry === 'function') enforceMenuExpiry();
            }
        }
    }, function (err) {
        console.warn('Cafe settings listener error:', err.message);
    });
}

function saveCafeSettingsToFirestore(data, callback) {
    if (USE_LOCAL_API) {
        localApiRequest('settings.php', {
            method: 'POST',
            body: { id: 'cafe', data: data }
        }).then(function() {
            if (callback) callback(null);
        }).catch(function(err) {
            if (callback) callback(err);
        });
        return;
    }
    
    if (!window.db) {
        if (callback) callback(new Error('Firestore not ready'));
        return;
    }

    var clientUpdatedAt = parseInt(data && data.clientUpdatedAt, 10) || Date.now();
    var payload = Object.assign({}, data, {
        clientUpdatedAt: clientUpdatedAt,
        updatedAt: serverTimestamp()
    });

    var timedOut = false;
    var timer = setTimeout(function () {
        timedOut = true;
        if (callback) callback(new Error('Connection timeout'));
    }, 12000);

    setDoc(doc(db, 'settings', 'cafe'), payload, { merge: true }).then(function () {
        clearTimeout(timer);
        if (!timedOut && callback) callback(null);
    }).catch(function (err) {
        clearTimeout(timer);
        if (!timedOut && callback) callback(err);
    });
}

window.loadCafeSettingsFromFirestore = loadCafeSettingsFromFirestore;
window.saveCafeSettingsToFirestore = saveCafeSettingsToFirestore;
window.subscribeCafeSettingsUpdates = subscribeCafeSettingsUpdates;
window.normalizeWhatsAppPhone = normalizeWhatsAppPhone;
window.normalizeSocialUrl = normalizeSocialUrl;
window.normalizeCafeTimeValue = normalizeCafeTimeValue;
window.formatCafeTimeForDisplay = formatCafeTimeForDisplay;
window.parseCafeTimeParts = parseCafeTimeParts;
window.buildCafeTimeFromParts = buildCafeTimeFromParts;
window.toLocaleDigits = toLocaleDigits;
window.applyCafeSettingsToLocalStorage = applyCafeSettingsToLocalStorage;
window.normalizeCafeBrandName = normalizeCafeBrandName;

var DEFAULT_CAFE_BRAND_NAME = 'BREW CAFE & REST';
var LEGACY_CAFE_BRAND_RE = /یاس|ياس|یاسمین|ياسمين|yasamin|yasmin|al[-\s]?sham|شام|zayed|زايد|زاید/i;

function normalizeCafeBrandName(name) {
    var n = String(name == null ? '' : name).trim();
    if (!n) return DEFAULT_CAFE_BRAND_NAME;
    if (LEGACY_CAFE_BRAND_RE.test(n)) return DEFAULT_CAFE_BRAND_NAME;
    return n;
}

function getCafeInfo(targetLang) {
    var lang = targetLang || localStorage.getItem('selectedLang') || document.documentElement.lang || 'ku';
    var defaultUrl = 'https://maps.app.goo.gl/mmi5iv7mnGKxKZoq9?g_st=ic';

    var defaultNames = {
        ku: 'بریو کافێ',
        ar: 'بریو کوفي',
        en: 'BREW CAFE & REST'
    };
    var defaultLabels = {
        ku: 'بەحرکە-مجەمع',
        ar: 'بحركة-المجمع',
        en: 'Baharka - Complex'
    };

    var storedUrl = localStorage.getItem('cafeLocationUrl');
    var storedLabel = localStorage.getItem('cafeLocationLabel');

    if (storedUrl === 'https://maps.google.com/?q=Baharka+Erbil') {
        localStorage.setItem('cafeLocationUrl', defaultUrl);
        storedUrl = defaultUrl;
    }
    if (storedLabel === 'baharka-erbil | شارع 150') {
        localStorage.setItem('cafeLocationLabel', defaultLabels.ku);
        storedLabel = defaultLabels.ku;
    }

    var openTime = normalizeCafeTimeValue(localStorage.getItem('cafeOpenTime'), '14:00');
    var closeTime = normalizeCafeTimeValue(localStorage.getItem('cafeCloseTime'), '02:00');
    var openMinutes = parseCafeTimeToMinutes(openTime, 14);
    var closeMinutes = parseCafeTimeToMinutes(closeTime, 2);

    // Multilingual Name Resolution with fallback
    var resolvedName = '';
    if (lang === 'ku') {
        resolvedName = localStorage.getItem('cafeNameKu') || localStorage.getItem('cafeName') || defaultNames.ku;
    } else if (lang === 'ar') {
        resolvedName = localStorage.getItem('cafeNameAr') || localStorage.getItem('cafeName') || defaultNames.ar;
    } else {
        resolvedName = localStorage.getItem('cafeNameEn') || localStorage.getItem('cafeName') || defaultNames.en;
    }
    resolvedName = normalizeCafeBrandName(resolvedName);

    // Multilingual Location Label Resolution with fallback
    var resolvedLabel = '';
    if (lang === 'ku') {
        resolvedLabel = localStorage.getItem('cafeLocationLabelKu') || storedLabel || defaultLabels.ku;
    } else if (lang === 'ar') {
        resolvedLabel = localStorage.getItem('cafeLocationLabelAr') || storedLabel || defaultLabels.ar;
    } else {
        resolvedLabel = localStorage.getItem('cafeLocationLabelEn') || storedLabel || defaultLabels.en;
    }

    return {
        name: resolvedName,
        nameKu: localStorage.getItem('cafeNameKu') || defaultNames.ku,
        nameAr: localStorage.getItem('cafeNameAr') || defaultNames.ar,
        nameEn: localStorage.getItem('cafeNameEn') || defaultNames.en,
        phone: normalizeWhatsAppPhone(localStorage.getItem('whatsappPhone') || '9647506454656'),
        locationUrl: storedUrl || defaultUrl,
        locationLabel: resolvedLabel,
        locationLabelKu: localStorage.getItem('cafeLocationLabelKu') || defaultLabels.ku,
        locationLabelAr: localStorage.getItem('cafeLocationLabelAr') || defaultLabels.ar,
        locationLabelEn: localStorage.getItem('cafeLocationLabelEn') || defaultLabels.en,
        instagram: localStorage.getItem('cafeInstagram') || '',
        tiktok: localStorage.getItem('cafeTiktok') || '',
        snapchat: localStorage.getItem('cafeSnapchat') || '',
        facebook: localStorage.getItem('cafeFacebook') || '',
        openTime: openTime,
        closeTime: closeTime,
        openHour: Math.floor(openMinutes / 60),
        closeHour: Math.floor(closeMinutes / 60),
        openMinutes: openMinutes,
        closeMinutes: closeMinutes
    };
}

function isCafeOpen(info) {
    info = info || getCafeInfo();
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var start = info.openMinutes != null ? info.openMinutes : info.openHour * 60;
    var end = info.closeMinutes != null ? info.closeMinutes : info.closeHour * 60;
    if (start === end) return false;
    if (start < end) return mins >= start && mins < end;
    return mins >= start || mins < end;
}

function formatCafePhone(phone) {
    var digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';

    if (digits.indexOf('964') === 0 && digits.length >= 12) {
        var local = digits.slice(3);
        if (local.length === 10) {
            return '+964 ' + local.slice(0, 3) + ' ' + local.slice(3, 6) + ' ' + local.slice(6);
        }
        return '+964 ' + local.slice(0, 3) + ' ' + local.slice(3);
    }

    if (digits.length >= 10) {
        return '+' + digits;
    }

    return '+' + digits;
}

function updateCafeInfoPanel() {
    var overlay = document.getElementById('cafeInfoOverlay');
    if (!overlay) return;

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    var info = getCafeInfo();
    var open = isCafeOpen(info);

    var statusEl = document.getElementById('cafeStatusBadge');
    if (statusEl) {
        statusEl.classList.toggle('is-open', open);
        statusEl.classList.toggle('is-closed', !open);
        var statusText = statusEl.querySelector('[data-cafe-status-text]');
        if (statusText) statusText.textContent = open ? strings.cafeOpen : strings.cafeClosed;
    }

    var titleEl = document.getElementById('cafeInfoTitle');
    if (titleEl) titleEl.textContent = info.name || strings.cafeInfoTitle;

    var hoursEl = document.getElementById('cafeHoursText');
    if (hoursEl) hoursEl.textContent = formatCafeHoursDisplay(info, lang);

    var addressEl = document.getElementById('cafeAddressLink');
    var addressText = document.getElementById('cafeAddressText');
    if (addressEl) addressEl.href = info.locationUrl;
    if (addressText) addressText.textContent = info.locationLabel;

    var phoneEl = document.getElementById('cafePhoneDisplay');
    if (phoneEl) {
        phoneEl.textContent = formatCafePhone(info.phone);
        phoneEl.setAttribute('dir', 'ltr');
    }

    var instaBtn = document.getElementById('cafeInstagramBtn');
    var tiktokBtn = document.getElementById('cafeTiktokBtn');
    var snapBtn = document.getElementById('cafeSnapchatBtn');
    var facebookBtn = document.getElementById('cafeFacebookBtn');
    var socialBlock = document.querySelector('.cafe-info-block--social');

    var instagramUrl = normalizeSocialUrl(info.instagram, 'instagram');
    var tiktokUrl = normalizeSocialUrl(info.tiktok, 'tiktok');
    var snapchatUrl = normalizeSocialUrl(info.snapchat, 'snapchat');
    var facebookUrl = normalizeSocialUrl(info.facebook, 'facebook');

    function wireSocialLink(btn, url) {
        if (!btn) return;
        if (url) {
            btn.href = url;
            btn.style.display = '';
            btn.removeAttribute('aria-hidden');
        } else {
            btn.href = '#';
            btn.style.display = 'none';
            btn.setAttribute('aria-hidden', 'true');
        }
    }

    wireSocialLink(instaBtn, instagramUrl);
    wireSocialLink(tiktokBtn, tiktokUrl);
    wireSocialLink(snapBtn, snapchatUrl);
    wireSocialLink(facebookBtn, facebookUrl);

    if (socialBlock) {
        socialBlock.style.display = (instagramUrl || tiktokUrl || snapchatUrl || facebookUrl) ? '' : 'none';
    }
}

function openCafeInfoPanel() {
    loadCafeSettingsFromFirestore(function () {
        updateCafeInfoPanel();
        var overlay = document.getElementById('cafeInfoOverlay');
        if (overlay) {
            overlay.classList.add('open');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('cafe-info-open');
        }
    });
}

function closeCafeInfoPanel() {
    var overlay = document.getElementById('cafeInfoOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('cafe-info-open');
    }
}

function shareCafeMenu() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var strings = i18n[lang] || i18n.en;
    var info = getCafeInfo();
    var url = window.location.href.split('#')[0];
    var payload = {
        title: info.name,
        text: info.name + ' — Menu',
        url: url
    };

    if (navigator.share) {
        navigator.share(payload).catch(function () {});
        return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
            alert(strings.linkCopied);
        });
        return;
    }

    prompt(strings.cafeShare, url);
}

function setupCafeInfoPanel() {
    var btn = document.getElementById('cafeInfoBtn');
    var overlay = document.getElementById('cafeInfoOverlay');
    if (!btn || !overlay) return;

    btn.addEventListener('click', openCafeInfoPanel);

    var closeBtn = document.getElementById('cafeInfoClose');
    if (closeBtn) closeBtn.addEventListener('click', closeCafeInfoPanel);

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.classList.contains('cafe-info-backdrop')) {
            closeCafeInfoPanel();
        }
    });

    var callBtn = document.getElementById('cafeCallBtn');
    if (callBtn) {
        callBtn.addEventListener('click', function () {
            var phone = normalizeWhatsAppPhone(getCafeInfo().phone);
            window.location.href = 'tel:+' + phone;
        });
    }

    var waBtn = document.getElementById('cafeWhatsappBtn');
    if (waBtn) {
        waBtn.addEventListener('click', function () {
            var phone = normalizeWhatsAppPhone(getCafeInfo().phone);
            window.open('https://wa.me/' + phone, '_blank');
        });
    }

    var shareBtn = document.getElementById('cafeShareBtn');
    if (shareBtn) shareBtn.addEventListener('click', shareCafeMenu);

    var locationBtn = document.getElementById('cafeLocationBtn');
    if (locationBtn) {
        locationBtn.addEventListener('click', function () {
            window.open(getCafeInfo().locationUrl, '_blank');
        });
    }

    var installHelpBtn = document.getElementById('cafeInstallHelpBtn');
    if (installHelpBtn && installHelpBtn.dataset.wired !== '1') {
        installHelpBtn.dataset.wired = '1';
        installHelpBtn.addEventListener('click', function () {
            closeCafeInfoPanel();
            openInstallTutorial();
        });
    }

    updateCafeInfoPanel();
    updateInstallHelpLabel();
    initCustomerReviews();
}

/* ==========================================================================
   CUSTOMER REVIEWS & FEEDBACK LOGIC (ULTRA LUXURY SUITE)
   ========================================================================== */

var _customerReviewsUnsub = null;
var _currentReviewAspect = 'all';
var _currentReviewScore = 5;
var _selectedQuickTags = [];
var _currentFeedFilter = 'all';
var _cachedAllGuestReviews = [];

function escapeHtmlText(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function initCustomerReviews() {
    var section = document.getElementById('cafeCustomerReviewsSection');
    if (!section || section.dataset.initialized === '1') return;
    section.dataset.initialized = '1';

    var aspectChips = section.querySelectorAll('.aspect-chip');
    var starBtns = section.querySelectorAll('.star-rating-btn');
    var feedbackStarsBadge = document.getElementById('feedbackStarsBadge');
    var feedbackText = document.getElementById('feedbackText');
    var quickChips = section.querySelectorAll('.quick-chip');
    var form = document.getElementById('cafeCustomerReviewForm');
    var successBox = document.getElementById('reviewSuccessState');
    var anotherBtn = document.getElementById('btnReviewAgain');
    var authorInput = document.getElementById('reviewAuthorName');
    var tableInput = document.getElementById('reviewTableOrPhone');
    var commentInput = document.getElementById('reviewComment');
    var charCountEl = document.getElementById('reviewCharCount');
    var submitBtn = document.getElementById('reviewSubmitButton');
    var feedFilterChips = section.querySelectorAll('.feed-filter-chip');

    var ratingFeedbackMap = {
        5: { badge: '5.0 ★', text: '👑 نایاب و شاهانە! • Flawless & Luxury' },
        4: { badge: '4.0 ★', text: '✨ زۆر باش و دڵخۆشکەر • Very Good' },
        3: { badge: '3.0 ★', text: '👍 باش و پەسەندکراو • Good' },
        2: { badge: '2.0 ★', text: '💬 مامناوەند • Fair' },
        1: { badge: '1.0 ★', text: '⚠️ پێویست بە باشترکردن • Needs Improvement' }
    };

    // Aspect category selection (Drinks, Foods, Service, Decor, All)
    aspectChips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            aspectChips.forEach(function (c) { c.classList.remove('active'); });
            chip.classList.add('active');
            _currentReviewAspect = chip.getAttribute('data-aspect') || 'all';
        });
    });

    // Star rating buttons with glow feedback
    function updateStarRating(score) {
        _currentReviewScore = score;
        starBtns.forEach(function (btn) {
            var btnScore = parseInt(btn.getAttribute('data-score') || '1', 10);
            btn.classList.toggle('active', btnScore <= score);
        });
        var feedback = ratingFeedbackMap[score] || ratingFeedbackMap[5];
        if (feedbackStarsBadge) feedbackStarsBadge.textContent = feedback.badge;
        if (feedbackText) feedbackText.textContent = feedback.text;
    }

    starBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var score = parseInt(btn.getAttribute('data-score') || '5', 10);
            updateStarRating(score);
        });
    });

    // Quick compliment tags selection
    quickChips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            chip.classList.toggle('selected');
            var tag = chip.getAttribute('data-tag') || chip.textContent.trim();
            if (chip.classList.contains('selected')) {
                if (_selectedQuickTags.indexOf(tag) === -1) _selectedQuickTags.push(tag);
            } else {
                _selectedQuickTags = _selectedQuickTags.filter(function (t) { return t !== tag; });
            }
        });
    });

    // Character counter for comment
    if (commentInput) {
        commentInput.addEventListener('input', function () {
            var len = this.value.length;
            if (charCountEl) {
                charCountEl.textContent = len + ' / 300';
                charCountEl.style.color = len >= 280 ? '#F59E0B' : '';
            }
        });
    }

    // Another review button
    if (anotherBtn) {
        anotherBtn.addEventListener('click', function () {
            if (successBox) successBox.style.display = 'none';
            if (form) form.style.display = 'block';
            if (commentInput) {
                commentInput.value = '';
                if (charCountEl) charCountEl.textContent = '0 / 300';
                commentInput.focus();
            }
            _selectedQuickTags = [];
            quickChips.forEach(function (c) { c.classList.remove('selected'); });
        });
    }

    // Feed category filtering
    feedFilterChips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            feedFilterChips.forEach(function (c) { c.classList.remove('active'); });
            chip.classList.add('active');
            _currentFeedFilter = chip.getAttribute('data-feed-cat') || 'all';
            renderGuestReviewsFiltered();
        });
    });

    // Submit form
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();

            var comment = (commentInput ? commentInput.value : '').trim();
            if (!comment) {
                if (commentInput) {
                    commentInput.focus();
                    commentInput.style.borderColor = '#ef4444';
                    setTimeout(function () { commentInput.style.borderColor = ''; }, 2000);
                }
                return;
            }

            var author = (authorInput ? authorInput.value : '').trim() || 'میوانی بەڕێز • Guest';
            var tableNum = (tableInput ? tableInput.value : '').trim();
            var payload = {
                author: author,
                table: tableNum,
                rating: _currentReviewScore,
                category: _currentReviewAspect,
                tags: _selectedQuickTags.slice(),
                comment: comment,
                likes: 0,
                status: 'active',
                createdAt: new Date().toISOString()
            };

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> دەپشکنرێت...';
            }

            function onSaveSuccess() {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span class="btn-shimmer-sweep"></span><span class="submit-text">ناردنی هەڵسەنگاندن • Submit Review</span> <i class="fa-solid fa-paper-plane"></i>';
                }
                if (form) form.style.display = 'none';
                if (successBox) successBox.style.display = 'block';
                // Cache locally
                try {
                    var cached = JSON.parse(localStorage.getItem('cachedCustomerReviews') || '[]');
                    cached.unshift(Object.assign({ id: 'loc_' + Date.now() }, payload));
                    localStorage.setItem('cachedCustomerReviews', JSON.stringify(cached.slice(0, 40)));
                } catch (e) {}
                loadCustomerReviewsFeed();
            }

            function onSaveError(err) {
                console.warn('Customer review save warning:', err);
                onSaveSuccess();
            }

            if (window.db && window.collection && window.addDoc) {
                var docData = Object.assign({}, payload);
                if (window.serverTimestamp) {
                    docData.timestamp = window.serverTimestamp();
                }
                addDoc(collection(db, 'customerReviews'), docData)
                    .then(onSaveSuccess)
                    .catch(function (err) {
                        if (typeof localApiRequest === 'function') {
                            localApiRequest('reviews.php', { method: 'POST', body: payload })
                                .then(onSaveSuccess)
                                .catch(onSaveError);
                        } else {
                            onSaveError(err);
                        }
                    });
            } else if (typeof localApiRequest === 'function') {
                localApiRequest('reviews.php', { method: 'POST', body: payload })
                    .then(onSaveSuccess)
                    .catch(onSaveError);
            } else {
                onSaveSuccess();
            }
        });
    }

    loadCustomerReviewsFeed();
}

function loadCustomerReviewsFeed() {
    function onReviewsReceived(items) {
        _cachedAllGuestReviews = items || [];
        updateLiveRatingHeader(_cachedAllGuestReviews);
        renderGuestReviewsFiltered();
    }

    if (window.db && window.collection && window.onSnapshot) {
        if (!_customerReviewsUnsub) {
            try {
                var q = window.query ? query(collection(db, 'customerReviews'), orderBy('createdAt', 'desc'), limit(30)) : collection(db, 'customerReviews');
                _customerReviewsUnsub = onSnapshot(q, function (snap) {
                    var items = [];
                    snap.forEach(function (doc) {
                        var data = doc.data() || {};
                        data.id = doc.id;
                        items.push(data);
                    });
                    onReviewsReceived(items);
                }, function () {
                    readFromCache();
                });
            } catch (e) {
                readFromCache();
            }
        }
    } else {
        readFromCache();
    }

    function readFromCache() {
        try {
            var cached = JSON.parse(localStorage.getItem('cachedCustomerReviews') || '[]');
            onReviewsReceived(cached);
        } catch (e) {
            onReviewsReceived([]);
        }
    }
}

function updateLiveRatingHeader(reviews) {
    var scoreVal = document.getElementById('cafeLiveScoreVal');
    var scoreCount = document.getElementById('cafeLiveScoreCount');
    var badge = document.getElementById('feedCountBadge');
    reviews = reviews || [];

    var total = reviews.length;
    if (badge) badge.textContent = total + ' ڕا';

    if (!total) {
        if (scoreVal) scoreVal.textContent = '5.0 ★';
        if (scoreCount) scoreCount.textContent = '(0 ڕا)';
        return;
    }

    var sum = reviews.reduce(function (acc, r) { return acc + parseInt(r.rating || 5, 10); }, 0);
    var avg = (sum / total).toFixed(1);
    if (scoreVal) scoreVal.textContent = avg + ' ★';
    if (scoreCount) scoreCount.textContent = '(' + total + ' ڕا)';
}

function renderGuestReviewsFiltered() {
    var container = document.getElementById('feedCardsWrap');
    if (!container) return;

    var all = _cachedAllGuestReviews || [];
    var filtered = all.filter(function (r) {
        if (_currentFeedFilter === 'all') return true;
        var c = r.category || 'all';
        if (_currentFeedFilter === 'drinks') return c === 'drinks' || c === 'drinks_food';
        if (_currentFeedFilter === 'foods') return c === 'foods';
        return c === _currentFeedFilter;
    });

    if (!filtered.length) {
        container.innerHTML = '<p class="feed-empty-hint">هێشتا ڕایەک لەم بەشە تۆمار نەکراوە، یەکەم کەس بە بۆچوونت بنووسە! ✨</p>';
        return;
    }

    var catMeta = {
        'all': { label: 'گشتی', icon: 'images/review-icons/star.svg', cls: 'cat-all' },
        'drinks': { label: 'خواردنەوەکان', icon: 'images/review-icons/drinks.svg', cls: 'cat-drinks' },
        'foods': { label: 'خواردنەکان', icon: 'images/review-icons/foods.svg', cls: 'cat-foods' },
        'drinks_food': { label: 'خواردنەوەکان', icon: 'images/review-icons/drinks.svg', cls: 'cat-drinks' },
        'service': { label: 'خزمەتگوزاری', icon: 'images/review-icons/service.svg', cls: 'cat-service' },
        'decor': { label: 'کەشوهەوا و دیزاین', icon: 'images/review-icons/decor.svg', cls: 'cat-decor' }
    };

    var html = '';
    filtered.slice(0, 10).forEach(function (r) {
        var stars = '';
        var rScore = parseInt(r.rating || 5, 10);
        for (var s = 1; s <= 5; s++) {
            stars += s <= rScore ? '★' : '☆';
        }

        var author = (r.author || 'میوانی بەڕێز').trim();
        var initial = author.charAt(0) || 'G';
        var meta = catMeta[r.category] || catMeta['all'];

        var tagsHtml = '';
        if (Array.isArray(r.tags) && r.tags.length) {
            tagsHtml = '<div class="feed-tags">' + r.tags.map(function (t) {
                return '<span class="feed-tag">' + escapeHtmlText(t) + '</span>';
            }).join('') + '</div>';
        }

        var tableStr = r.table ? (' • مێز: ' + escapeHtmlText(r.table)) : '';

        html +=
            '<div class="feed-card" data-id="' + escapeHtmlText(r.id || '') + '">' +
                '<div class="feed-card-head">' +
                    '<div class="feed-author">' +
                        '<span class="feed-author-avatar">' + escapeHtmlText(initial) + '</span>' +
                        '<div class="feed-author-details">' +
                            '<span class="feed-author-name">' + escapeHtmlText(author) + '</span>' +
                            '<span class="feed-author-meta">' +
                                '<span class="feed-verified-badge"><i class="fa-solid fa-circle-check"></i> میوانی پەسەندکراو</span>' +
                                tableStr +
                            '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="feed-card-badge-wrap">' +
                        '<span class="feed-cat-pill ' + meta.cls + '">' +
                            '<img src="' + meta.icon + '" class="feed-cat-pill-icon" alt="">' +
                            '<span>' + meta.label + '</span>' +
                        '</span>' +
                    '</div>' +
                '</div>' +

                '<div class="feed-rating-stars-row">' +
                    '<span class="feed-stars">' + stars + '</span>' +
                    '<span class="feed-score-badge">' + rScore + '.0</span>' +
                '</div>' +

                '<p class="feed-comment">“' + escapeHtmlText(r.comment || '') + '”</p>' +
                tagsHtml +
            '</div>';
    });

    container.innerHTML = html;
}

function openCartPanel() {
    renderCartItems();
    updateCustomerFieldPlaceholders();
    clearCartFormWarning();
    var overlay = document.getElementById('cartOverlay');
    if (overlay) {
        overlay.classList.add('open');
        document.body.classList.add('cart-open');
    }
}

function updateCustomerFieldPlaceholders() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var ph = {
        ku: { name: 'ناوی بەڕێزتان؟', place: 'شوێنی بەڕێزتان؟' },
        ar: { name: 'اسمك الكريم؟', place: 'موقعك؟' },
        en: { name: 'Your name?', place: 'Your location?' }
    };
    var p = ph[lang] || ph.en;
    var nameEl = document.getElementById('customerName');
    var placeEl = document.getElementById('customerPlace');
    if (nameEl) nameEl.placeholder = p.name;
    if (placeEl) placeEl.placeholder = p.place;
}

function closeCartPanel() {
    var overlay = document.getElementById('cartOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        document.body.classList.remove('cart-open');
    }
}

function renderCartItems() {
    var container = document.getElementById('cartItems');
    var emptyEl = document.getElementById('cartEmpty');
    var totalEl = document.getElementById('cartTotal');
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;

    if (!container) return;

    if (cartItems.length === 0) {
        container.innerHTML = '<div class="cart-empty">' +
            '<div class="cart-empty-icon">🛒</div>' +
            '<p>' + S.cartEmpty + '</p>' +
        '</div>';
        if (totalEl) totalEl.textContent = '0 IQD';
        return;
    }

    var total = 0;
    var html = '';
    cartItems.forEach(function(item) {
        var subtotal = item.price * item.quantity;
        total += subtotal;
        var fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%27100%27%3E%3Crect fill=%231a1a1a width=%27100%27 height=%27100%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23D4AF37%27%3E%E2%98%95%3C/text%3E%3C/svg%3E';
        var img = item.image || fallbackImage;

        html += '<div class="cart-item">' +
            '<div class="cart-item-img">' +
                '<img src="' + img + '" alt="' + item.name + '" onerror="this.onerror=null;this.src=\'' + fallbackImage + '\'">' +
            '</div>' +
            '<div class="cart-item-info">' +
                '<span class="cart-item-name">' + item.name + '</span>' +
                '<span class="cart-item-price">' + item.price.toLocaleString() + ' IQD</span>' +
            '</div>' +
            '<div class="cart-item-qty">' +
                '<button class="cart-qty-btn minus" data-id="' + item.id + '">−</button>' +
                '<span class="cart-qty-val">' + item.quantity + '</span>' +
                '<button class="cart-qty-btn plus" data-id="' + item.id + '">+</button>' +
            '</div>' +
            '<div class="cart-item-subtotal">' + subtotal.toLocaleString() + ' IQD</div>' +
            '<button class="cart-item-remove" data-id="' + item.id + '">✕</button>' +
        '</div>';
    });

    container.innerHTML = html;
    if (totalEl) totalEl.textContent = total.toLocaleString() + ' IQD';

    // Event listeners
    container.querySelectorAll('.cart-qty-btn.minus').forEach(function(btn) {
        btn.addEventListener('click', function() {
            updateCartQuantity(this.getAttribute('data-id'), -1);
            renderCartItems();
        });
    });

    container.querySelectorAll('.cart-qty-btn.plus').forEach(function(btn) {
        btn.addEventListener('click', function() {
            updateCartQuantity(this.getAttribute('data-id'), 1);
            renderCartItems();
        });
    });

    container.querySelectorAll('.cart-item-remove').forEach(function(btn) {
        btn.addEventListener('click', function() {
            removeFromCart(this.getAttribute('data-id'));
            renderCartItems();
        });
    });
}

/* ========================================
    Favorites panel
    ======================================== */

function updateFavBadge() {
    var badges = document.querySelectorAll('#favBadge, .fav-badge');
    var favs = MENU_FEATURES.getFavorites();
    var count = Array.isArray(favs) ? favs.length : 0;
    badges.forEach(function (badge) {
        badge.textContent = String(count);
        badge.classList.toggle('show', count > 0);
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    });
}

function findMenuItemById(itemId) {
    if (itemId == null || itemId === '') return null;
    var targetStr = String(itemId).trim();
    if (Array.isArray(cachedMenuItems)) {
        for (var i = 0; i < cachedMenuItems.length; i++) {
            var mItem = cachedMenuItems[i];
            if (mItem && (String(mItem.id).trim() === targetStr || String(mItem._id).trim() === targetStr)) {
                return mItem;
            }
        }
    }
    if (window.MenuData && typeof MenuData.getItems === 'function') {
        var items = MenuData.getItems() || [];
        for (var j = 0; j < items.length; j++) {
            var row = items[j];
            var data = row && (row.data || row);
            var id = row && (row.id || (typeof data === 'function' ? data().id : (data && data.id)));
            if (id && String(id).trim() === targetStr) {
                return Object.assign({ id: id }, typeof data === 'function' ? data() : data);
            }
        }
    }
    return null;
}

function openFavPanel() {
    renderFavItems();
    var overlay = document.getElementById('favOverlay');
    if (overlay) {
        overlay.classList.add('open');
        document.body.classList.add('fav-open');
    }
    updateFavBadge();
}

function closeFavPanel() {
    var overlay = document.getElementById('favOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        document.body.classList.remove('fav-open');
    }
}

function renderFavItems() {
    var container = document.getElementById('favItems');
    if (!container) return;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.ku || i18n.en;
    var favIds = MENU_FEATURES.getFavorites();
    var fallbackImage = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27100%27 height=%27100%27%3E%3Crect fill=%231a1a1a width=%27100%27 height=%27100%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23EF4444%27%3E%E2%99%A5%3C/text%3E%3C/svg%3E';

    var clearBtn = document.getElementById('favClearBtn');
    var favFooter = document.getElementById('favFooter');
    var favFooterCount = document.getElementById('favFooterCount');
    var favFooterTotal = document.getElementById('favFooterTotal');
    var favSubtitle = document.getElementById('favSubtitle');
    var favCountPill = document.getElementById('favCountPill');

    var subtitleTexts = {
        ku: 'خواردنەوە و بەرهەمە دڵخوازەکانت',
        ar: 'مشروباتك ومنتجاتك المفضلة',
        en: 'Your saved favorite drinks & dishes'
    };
    if (favSubtitle) {
        favSubtitle.textContent = subtitleTexts[lang] || subtitleTexts.ku;
    }

    // Filter valid items
    var validItems = [];
    var totalPrice = 0;
    favIds.forEach(function (id) {
        var item = findMenuItemById(id);
        if (item) {
            validItems.push(item);
            totalPrice += parseItemPrice(item.price);
        }
    });

    if (favCountPill) {
        favCountPill.textContent = String(validItems.length);
        favCountPill.style.display = validItems.length > 0 ? 'inline-flex' : 'none';
    }

    if (!validItems.length) {
        if (clearBtn) clearBtn.style.display = 'none';
        if (favFooter) favFooter.style.display = 'none';

        var emptyTitles = {
            ku: 'دڵخوازەکانت بەتاڵە',
            ar: 'قائمتك المفضلة فارغة',
            en: 'No Favorites Yet'
        };
        var emptyHints = {
            ku: 'هەر خواردنەوە یان شیرینیەکت بەدڵ بوو لەسەر نیشانەی دڵ 🤍 دابگرە تاوەکو لێرە بیبینیتەوە و بە خێرایی داوای بکەیت',
            ar: 'اضغط على رمز القلب 🤍 على أي صنف لتجده هنا وتطلبه بنقرة واحدة',
            en: 'Tap the heart icon 🤍 on any item to save it here for instant ordering'
        };
        var exploreTexts = {
            ku: 'گەڕان لە مێنیو',
            ar: 'تصفح المنيو',
            en: 'Explore Menu'
        };

        container.innerHTML =
            '<div class="fav-empty">' +
                '<div class="fav-empty-emblem">' +
                    '<div class="fav-empty-glow"></div>' +
                    '<div class="fav-empty-icon-wrap">' +
                        '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">' +
                            '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
                        '</svg>' +
                    '</div>' +
                '</div>' +
                '<h3 class="fav-empty-title">' + (emptyTitles[lang] || emptyTitles.ku) + '</h3>' +
                '<p class="fav-empty-desc">' + (emptyHints[lang] || emptyHints.ku) + '</p>' +
                '<button type="button" class="fav-explore-btn" id="favExploreBtn">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                        '<circle cx="11" cy="11" r="8"></circle>' +
                        '<line x1="21" y1="21" x2="16.65" y2="16.65"></line>' +
                    '</svg>' +
                    '<span>' + (exploreTexts[lang] || exploreTexts.ku) + '</span>' +
                '</button>' +
            '</div>';

        var exploreBtn = document.getElementById('favExploreBtn');
        if (exploreBtn) {
            exploreBtn.onclick = function () {
                closeFavPanel();
                var grid = document.getElementById('menuGrid') || document.getElementById('categoriesNav');
                if (grid) {
                    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            };
        }
        return;
    }

    // Has items: Show clear button & footer
    if (clearBtn) {
        clearBtn.style.display = 'inline-flex';
        var clearLabels = { ku: 'سڕینەوە', ar: 'مسح', en: 'Clear' };
        var clearTextEl = clearBtn.querySelector('.fav-clear-text');
        if (clearTextEl) clearTextEl.textContent = clearLabels[lang] || clearLabels.ku;
        clearBtn.onclick = function (e) {
            e.stopPropagation();
            MENU_FEATURES.clearAll();
            updateFavBadge();
            renderFavItems();
            document.querySelectorAll('.menu-card-fav').forEach(function (cardBtn) {
                cardBtn.classList.remove('is-fav');
                var svg = cardBtn.querySelector('svg');
                if (svg) svg.setAttribute('fill', 'none');
            });
        };
    }

    if (favFooter) {
        favFooter.style.display = 'flex';
        if (favFooterCount) {
            var countWord = {
                ku: validItems.length + ' بەرهەم',
                ar: validItems.length + ' أصناف',
                en: validItems.length + ' Items'
            };
            favFooterCount.textContent = countWord[lang] || countWord.ku;
        }
        if (favFooterTotal) {
            favFooterTotal.textContent = (totalPrice > 0 ? totalPrice.toLocaleString() : '0') + ' IQD';
        }
        var addAllBtn = document.getElementById('favAddAllBtn');
        var addAllText = document.getElementById('favAddAllText');
        if (addAllText) {
            var addAllLabels = {
                ku: 'هەمووی زیادبکە بۆ سەبەتە 🛒',
                ar: 'إضافة الكل للسلة 🛒',
                en: 'Add All to Cart 🛒'
            };
            addAllText.textContent = addAllLabels[lang] || addAllLabels.ku;
        }
        if (addAllBtn) {
            addAllBtn.onclick = function (e) {
                e.stopPropagation();
                validItems.forEach(function (itm) {
                    addToCart(itm);
                });
                addAllBtn.classList.add('added');
                if (addAllText) {
                    var addedAllMap = {
                        ku: 'هەمووی زیادکرا! ✓',
                        ar: 'تمت إضافة الكل! ✓',
                        en: 'All Added! ✓'
                    };
                    addAllText.textContent = addedAllMap[lang] || addedAllMap.ku;
                }
                setTimeout(function () {
                    addAllBtn.classList.remove('added');
                    renderFavItems();
                }, 1300);
            };
        }
    }

    var addCartLabels = {
        ku: '+ زیادکردن',
        ar: '+ إضافة',
        en: '+ Add to Cart'
    };
    var removeLabels = {
        ku: 'لابردن',
        ar: 'إزالة',
        en: 'Remove'
    };
    var sizeWords = {
        ku: 'قەبارە',
        ar: 'أحجام',
        en: 'sizes'
    };
    var viewDetailsHint = {
        ku: 'دەست لێبدە بۆ بینینی هەڵبژاردەکان',
        ar: 'اضغط لعرض التفاصيل والأحجام',
        en: 'Tap to view details & options'
    };

    var html = '';
    validItems.forEach(function (item) {
        var id = String(item.id);
        var name = item['name_' + lang] || item.name_en || item.name_ar || item.name_ku || item.name || 'Item';
        var price = parseItemPrice(item.price);
        var priceFormatted = price > 0 ? price.toLocaleString() : '0';
        var img = normalizeImageUrl(item.image) || fallbackImage;
        var hasSizes = item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0;
        var categoryName = item.category ? (item['category_' + lang] || item.category) : '';
        var desc = item['description_' + lang] || item.description_en || item.description_ar || item.description_ku || item.description || '';
        var descHtml = desc ? '<p class="fav-item-desc">' + desc + '</p>' : '';

        var cartMatch = Array.isArray(cartItems) ? cartItems.filter(function (ci) {
            return ci.itemId === item.id || ci.id === id || ci.id.indexOf(id + '_') === 0;
        }) : [];
        var qtyInCart = cartMatch.reduce(function (sum, ci) { return sum + (ci.quantity || 1); }, 0);
        var inCartPill = '';
        if (qtyInCart > 0) {
            var inCartLabel = {
                ku: qtyInCart + ' لە سەبەتەدایە',
                ar: qtyInCart + ' في السلة',
                en: qtyInCart + ' in cart'
            };
            inCartPill = '<span class="fav-in-cart-pill">🛒 ' + (inCartLabel[lang] || inCartLabel.ku) + '</span>';
        }

        var sizeBadge = '';
        if (hasSizes) {
            sizeBadge = '<span class="fav-item-size-badge">' + item.sizes.length + ' ' + (sizeWords[lang] || sizeWords.ku) + '</span>';
        }

        html +=
            '<div class="fav-item" data-id="' + id + '">' +
                '<div class="fav-item-media" data-open-id="' + id + '" title="' + (viewDetailsHint[lang] || viewDetailsHint.ku) + '">' +
                    '<img src="' + img + '" alt="' + name + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + fallbackImage + '\'">' +
                    sizeBadge +
                '</div>' +
                '<div class="fav-item-info" data-open-id="' + id + '" title="' + (viewDetailsHint[lang] || viewDetailsHint.ku) + '">' +
                    '<div class="fav-item-topline">' +
                        (categoryName ? '<span class="fav-item-cat-label">' + categoryName + '</span>' : '') +
                        inCartPill +
                    '</div>' +
                    '<h4 class="fav-item-name">' + name + '</h4>' +
                    descHtml +
                    '<div class="fav-item-pricing">' +
                        '<span class="fav-item-price">' + priceFormatted + ' IQD</span>' +
                        (hasSizes ? '<span class="fav-item-sizes-hint">✨ ' + (lang === 'ku' ? 'چەندین قەبارە' : (lang === 'ar' ? 'خيارات متعددة' : 'Size choices')) + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="fav-item-actions">' +
                    '<button type="button" class="fav-item-cart-btn" data-id="' + id + '" aria-label="' + (addCartLabels[lang] || addCartLabels.ku) + '">' +
                        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
                            '<line x1="12" y1="5" x2="12" y2="19"></line>' +
                            '<line x1="5" y1="12" x2="19" y2="12"></line>' +
                        '</svg>' +
                        '<span class="fav-cart-text">' + (addCartLabels[lang] || addCartLabels.ku) + '</span>' +
                    '</button>' +
                    '<button type="button" class="fav-item-remove-btn" data-id="' + id + '" title="' + (removeLabels[lang] || removeLabels.ku) + '" aria-label="' + (removeLabels[lang] || removeLabels.ku) + '">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                            '<polyline points="3 6 5 6 21 6"></polyline>' +
                            '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                        '</svg>' +
                    '</button>' +
                '</div>' +
            '</div>';
    });

    container.innerHTML = html;

    // Attach click on image/info to open detail
    container.querySelectorAll('[data-open-id]').forEach(function (el) {
        el.addEventListener('click', function (e) {
            e.stopPropagation();
            var targetId = this.getAttribute('data-open-id');
            var item = findMenuItemById(targetId);
            if (item) {
                closeFavPanel();
                openProductDetail(item);
            }
        });
    });

    // Attach click on Add to Cart button
    container.querySelectorAll('.fav-item-cart-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var itemId = this.getAttribute('data-id');
            var item = findMenuItemById(itemId);
            if (!item) return;

            var cartTextEl = this.querySelector('.fav-cart-text');
            btn.classList.add('added');
            if (cartTextEl) {
                var addedTextMap = {
                    ku: 'زیادکرا! ✓',
                    ar: 'تمت الإضافة! ✓',
                    en: 'Added! ✓'
                };
                cartTextEl.textContent = addedTextMap[lang] || addedTextMap.ku;
            }

            addToCart(item);

            setTimeout(function () {
                btn.classList.remove('added');
                renderFavItems();
            }, 1000);
        });
    });

    // Attach click on remove button
    container.querySelectorAll('.fav-item-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var itemId = this.getAttribute('data-id');
            var card = this.closest('.fav-item');
            if (card) {
                card.classList.add('removing');
            }
            setTimeout(function () {
                MENU_FEATURES.toggleFav(itemId);
                updateFavBadge();
                renderFavItems();
                document.querySelectorAll('.menu-card-fav[data-item-id="' + itemId + '"]').forEach(function (cardBtn) {
                    cardBtn.classList.remove('is-fav');
                    var svg = cardBtn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', 'none');
                });
            }, 220);
        });
    });
}

function renderMenuCardsWithFeatures() {
    updateFavBadge();
}

/* ========================================
    PWA Service Worker Registration
    ======================================== */

function checkForAppUpdate() {
    if (!navigator.onLine) return;
    fetch('./version.txt?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (text) {
            var remote = (text || '').trim();
            if (!remote) return;
            var key = 'aliCafeAppBuild';
            var seen = localStorage.getItem(key);
            if (seen && seen !== remote) {
                localStorage.setItem(key, remote);
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
                }
                console.log('[PWA] New version ready in background:', remote);
                return;
            }
            if (!seen) localStorage.setItem(key, remote);
        })
        .catch(function () {});
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) return;
        refreshing = true;
        console.log('[PWA] Service worker updated');
    });

    navigator.serviceWorker.register('./sw.js?v=119').then(function (reg) {
        function activateWaiting(worker) {
            if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
        }
        if (reg.waiting) activateWaiting(reg.waiting);
        reg.addEventListener('updatefound', function () {
            var worker = reg.installing;
            if (!worker) return;
            worker.addEventListener('statechange', function () {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    activateWaiting(worker);
                }
            });
        });

        function pokeServiceWorker() {
            reg.update().catch(function () {});
            checkForAppUpdate();
        }

        pokeServiceWorker();
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') pokeServiceWorker();
        });
        window.addEventListener('focus', pokeServiceWorker);
        window.addEventListener('pageshow', function (event) {
            if (event.persisted) pokeServiceWorker();
        });
    }).catch(function (err) {
        console.warn('Service worker registration failed:', err);
    });
}

window.registerServiceWorker = registerServiceWorker;
window.checkForAppUpdate = checkForAppUpdate;

/* ========================================
   Add to Home Screen — image tutorial (menu only)
   Put PNG/JPG files in images/install/ (see README there)
   ======================================== */

var INSTALL_TUTORIAL_IMAGES = {
    ios: [
        'images/install/ios-step-1.png?v=3',
        'images/install/ios-step-2.png?v=3',
        'images/install/ios-step-3.png?v=3',
        'images/install/ios-step-4.png?v=3'
    ],
    android: [
        'images/install/android-step-1.png?v=2',
        'images/install/android-step-2.png?v=2',
        'images/install/android-step-3.png?v=2',
        'images/install/android-step-4.png?v=2'
    ]
};

function updateInstallHelpLabel() {
    var helpBtn = document.getElementById('cafeInstallHelpBtn');
    if (!helpBtn) return;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;
    var helpSpan = helpBtn.querySelector('[data-i18n-install]');
    if (helpSpan) helpSpan.textContent = S.installShowHelp;
}

function ensureInstallTutorialDOM() {
    if (document.getElementById('installTutorialOverlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'install-tutorial-overlay';
    overlay.id = 'installTutorialOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
        '<div class="install-tutorial-backdrop"></div>' +
        '<div class="install-tutorial-panel install-tutorial-panel--images" role="dialog" aria-labelledby="installTutorialTitle">' +
            '<button type="button" class="install-tutorial-close" id="installTutorialClose" aria-label="Close">✕</button>' +
            '<div class="install-tutorial-badge" aria-hidden="true">📲</div>' +
            '<h2 class="install-tutorial-title" id="installTutorialTitle"></h2>' +
            '<p class="install-tutorial-sub" id="installTutorialSub"></p>' +
            '<div class="install-platform-tabs" id="installPlatformTabs">' +
                '<button type="button" class="install-platform-tab active" data-platform="ios" id="installTabIos"></button>' +
                '<button type="button" class="install-platform-tab" data-platform="android" id="installTabAndroid"></button>' +
            '</div>' +
            '<div class="install-images-list" id="installStepsIos"></div>' +
            '<div class="install-images-list hidden" id="installStepsAndroid" hidden></div>' +
            '<p class="install-images-empty hidden" id="installImagesEmpty"></p>' +
            '<button type="button" class="install-tutorial-primary" id="installTutorialGotIt"></button>' +
        '</div>';
    document.body.appendChild(overlay);
    wireInstallTutorialOverlay(overlay);
}

function wireInstallTutorialOverlay(overlay) {
    if (!overlay || overlay.dataset.wired === '1') return;
    overlay.dataset.wired = '1';

    var closeBtn = document.getElementById('installTutorialClose');
    var gotIt = document.getElementById('installTutorialGotIt');
    if (closeBtn) closeBtn.addEventListener('click', closeInstallTutorial);
    if (gotIt) gotIt.addEventListener('click', closeInstallTutorial);

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.classList.contains('install-tutorial-backdrop')) {
            closeInstallTutorial();
        }
    });

    document.querySelectorAll('.install-platform-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            setInstallPlatformTab(tab.getAttribute('data-platform'));
            updateInstallTutorialUI();
        });
    });
}

function setInstallPlatformTab(platform) {
    _installTutorialPlatform = platform;
    var iosSteps = document.getElementById('installStepsIos');
    var androidSteps = document.getElementById('installStepsAndroid');
    document.querySelectorAll('.install-platform-tab').forEach(function (tab) {
        tab.classList.toggle('active', tab.getAttribute('data-platform') === platform);
    });
    if (iosSteps) {
        iosSteps.classList.toggle('hidden', platform !== 'ios');
        iosSteps.hidden = platform !== 'ios';
    }
    if (androidSteps) {
        androidSteps.classList.toggle('hidden', platform !== 'android');
        androidSteps.hidden = platform !== 'android';
    }
}

var _installTutorialPlatform = '';

function getMobilePlatform() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
        return 'ios';
    }
    if (/Android/i.test(ua)) return 'android';
    return 'ios';
}

function buildInstallImageHtml(stepNum, imageSrc) {
    return (
        '<div class="install-image-card">' +
            '<span class="install-image-num">' + stepNum + '</span>' +
            '<img src="' + imageSrc + '" alt="" loading="lazy" ' +
            'onerror="this.closest(\'.install-image-card\').classList.add(\'is-missing\')">' +
        '</div>'
    );
}

function renderInstallImagesList(container, images) {
    if (!container) return 0;
    var html = '';
    var count = 0;
    for (var i = 0; i < images.length; i++) {
        if (images[i]) {
            html += buildInstallImageHtml(i + 1, images[i]);
            count++;
        }
    }
    container.innerHTML = html;
    return count;
}

function updateInstallTutorialUI() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;

    var title = document.getElementById('installTutorialTitle');
    var subtitle = document.getElementById('installTutorialSub');
    var tabIos = document.getElementById('installTabIos');
    var tabAndroid = document.getElementById('installTabAndroid');
    var gotIt = document.getElementById('installTutorialGotIt');
    var emptyMsg = document.getElementById('installImagesEmpty');

    if (title) title.textContent = S.installTitle;
    if (subtitle) subtitle.textContent = S.installSubtitle || '';
    if (tabIos) tabIos.textContent = S.installIos;
    if (tabAndroid) tabAndroid.textContent = S.installAndroid;
    if (gotIt) gotIt.textContent = S.installGotIt;

    var iosCount = renderInstallImagesList(document.getElementById('installStepsIos'), INSTALL_TUTORIAL_IMAGES.ios);
    var androidCount = renderInstallImagesList(document.getElementById('installStepsAndroid'), INSTALL_TUTORIAL_IMAGES.android);

    if (emptyMsg) {
        var platform = _installTutorialPlatform || getMobilePlatform();
        var visible = platform === 'ios' ? iosCount : androidCount;
        emptyMsg.textContent = S.installImagesMissing || 'Add tutorial images to images/install/';
        emptyMsg.classList.toggle('hidden', visible > 0);
    }

    updateInstallHelpLabel();
}

function openInstallTutorial() {
    ensureInstallTutorialDOM();
    updateInstallTutorialUI();
    setInstallPlatformTab(getMobilePlatform());

    var overlay = document.getElementById('installTutorialOverlay');
    if (overlay) {
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('install-tutorial-open');
    }
}

function closeInstallTutorial() {
    var overlay = document.getElementById('installTutorialOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('install-tutorial-open');
    }
}

function setupInstallTutorial() {
    if (!document.getElementById('cafeInstallHelpBtn')) return;
    updateInstallHelpLabel();
}

window.openInstallTutorial = openInstallTutorial;

/* ========================================
   Utilities
   ======================================== */

function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    var trimmed = url.trim();
    if (!trimmed) return null;
    if (trimmed.indexOf('data:image/') === 0 || trimmed.indexOf('blob:') === 0 ||
        trimmed.indexOf('/') === 0 || trimmed.indexOf('./') === 0 || trimmed.indexOf('../') === 0 ||
        trimmed.indexOf('images/') === 0 || trimmed.indexOf('assets/') === 0) {
        return trimmed;
    }
    try {
        new URL(trimmed);
        return trimmed;
    } catch (e) {
        return trimmed;
    }
}

/* ========================================
   Logo navigation (single + double click)
   ======================================== */

window.replayLogoSplash = function (splashEl, durationMs) {
    if (!splashEl) splashEl = document.getElementById('logoSplash');
    if (!splashEl) return;

    var ms = durationMs || 1200;
    splashEl.style.display = 'flex';
    splashEl.classList.remove('hidden');
    clearTimeout(window.replayLogoSplash._hideTimer);
    window.replayLogoSplash._hideTimer = setTimeout(function () {
        splashEl.classList.add('hidden');
        setTimeout(function () { splashEl.style.display = 'none'; }, 500);
    }, ms);
};

window.setupLogoClickActions = function (logoEl, onSingleClick, doubleClickHref) {
    if (!logoEl) return;

    var clicks = 0;
    var timer = null;
    var doubleHref = doubleClickHref || 'login.html';
    var delay = 320;

    logoEl.style.cursor = 'pointer';
    logoEl.setAttribute('role', 'link');
    logoEl.tabIndex = logoEl.tabIndex >= 0 ? logoEl.tabIndex : 0;

    function goSingle() {
        if (typeof onSingleClick === 'function') {
            onSingleClick();
            return;
        }
        if (typeof onSingleClick === 'string' && onSingleClick) {
            window.location.href = onSingleClick;
        }
    }

    logoEl.addEventListener('click', function (e) {
        // Prevent <a href> from navigating before single/double is decided
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        clicks++;
        if (clicks === 1) {
            timer = setTimeout(function () {
                clicks = 0;
                goSingle();
            }, delay);
        } else if (clicks >= 2) {
            clearTimeout(timer);
            clicks = 0;
            window.location.href = doubleHref;
        }
    });
};

// Immediate rendering of cached menu as soon as app.js evaluates (before DOMContentLoaded)
try {
    if (document.getElementById('menuGrid') && typeof showCachedMenuIfAvailable === 'function') {
        showCachedMenuIfAvailable();
    }
} catch (e) {}


