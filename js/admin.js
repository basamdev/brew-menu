// Admin.js — Shawarma Admin Panel

var USE_LOCAL_API = false;
var API_BASE = 'api';

if (USE_LOCAL_API && typeof console !== 'undefined' && console.error) {
    var originalConsoleError = console.error;
    console.error = function() {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.join(' ');
        if (msg.indexOf('Cloud Firestore API') !== -1 || 
            msg.indexOf('Could not reach Cloud Firestore backend') !== -1 ||
            msg.indexOf('firestore.googleapis.com') !== -1) {
            return;
        }
        originalConsoleError.apply(console, args);
    };
}

function localApiRequest(endpoint, options) {
    options = options || {};
    // Resolve the API URL absolutely so requests work regardless of how the
    // page is served (relative URLs break when the document and API differ
    // in origin/path).
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

const orderItems = [];
let activeItemModal = null;
let cashierUnsubscribe = null;
let cashierActiveFilter = 'all';
let categoriesUnsubscribe = null;
let itemsUnsubscribe = null;
var dashboardUnsubscribes = [];
var _itemsSnapDocs = [];
var _adminSalesLive = null;
var _adminExpensesLive = null;
var _adminLiveListenersStarted = false;
var _adminResetInProgress = false;
window._firestoreApiDisabled = false;
let itemsActiveCategory = 'all';

/* ============ OFFLINE CACHE (localStorage backup for admin) ============ */

function readCachedMenuItemsFlat() {
    try {
        return JSON.parse(localStorage.getItem('cachedMenuItems') || '[]');
    } catch (e) {
        return [];
    }
}

function writeCachedMenuItemsFlat(items) {
    try {
        localStorage.setItem('cachedMenuItems', JSON.stringify(items));
        syncCashierCacheFromMenuFlat(items);
    } catch (e) {
        console.warn('Could not write menu cache:', e);
    }
}

function syncCashierCacheFromMenuFlat(items) {
    var cashier = [];
    (items || []).forEach(function (it) {
        if (!it || !it.id || (it.category && it.category.toLowerCase().trim() === 'water') || it.available === false) return;
        var v = Object.assign({}, it);
        delete v.id;
        cashier.push({ id: it.id, v: v });
    });
    try {
        localStorage.setItem('cachedCashierItems', JSON.stringify(cashier));
    } catch (e) {}
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message || '')) {
            evictNonEssentialCacheKeys();
            try {
                localStorage.setItem(key, value);
            } catch (e2) {
                console.warn('[storage] setItem still failed after cleanup for', key, ':', e2.message);
            }
        } else {
            console.warn('[storage] setItem failed for', key, ':', e.message);
        }
    }
}

// Keys that can be dropped to free space when the quota is hit. `cachedCategories`
// is intentionally excluded so the category bar keeps rendering with images/order.
var NON_ESSENTIAL_CACHE_KEYS = [
    'cachedMenuItems',
    'cachedMenuItemsSig',
    'cachedCashierItems',
    'cachedMenuCategoryNames',
    'cachedSales',
    'cachedExpenses'
];

function evictNonEssentialCacheKeys() {
    NON_ESSENTIAL_CACHE_KEYS.forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
    });
}

function serializableFirestoreData(data) {
    var o = Object.assign({}, data || {});
    delete o.updated_at;
    delete o.created_at;
    return o;
}

function fakeFirestoreDoc(id, data) {
    var payload = Object.assign({}, data);
    return {
        id: id,
        exists: true,
        data: function () { return payload; }
    };
}

function getCurrentAdminEmail() {
    if (window.currentUser && window.currentUser.email) return window.currentUser.email;
    if (window.auth && auth.currentUser && auth.currentUser.email) return auth.currentUser.email;
    return null;
}

function withOwnerFilter(query) {
    var email = getCurrentAdminEmail();
    if (!email) return query;
    // NOTE: Firestore does NOT support `null` inside an `in`/`array-contains-any`
    // query, so we use a plain equality filter. Items created before ownership
    // tracking existed are backfilled by backfillCreatedByForCurrentAdmin().
    return query.where('createdBy', '==', email);
}

function backfillCreatedByForCurrentAdmin() {
    var email = getCurrentAdminEmail();
    if (!email || !window.db) return;
    if (localStorage.getItem('createdByBackfilled_' + email)) return;
    getDocs(collection(db, 'menuItems')).then(function (snap) {
        var batch = writeBatch(db);
        var updated = 0;
        snap.forEach(function (doc) {
            var data = doc.data();
            if (!data.createdBy) {
                batch.update(doc.ref, { createdBy: email });
                updated++;
            }
        });
        if (updated > 0) {
            batch.commit().then(function () {
                localStorage.setItem('createdByBackfilled_' + email, '1');
                console.log('[backfill] Tagged ' + updated + ' items with createdBy');
            }).catch(function () {});
        } else {
            localStorage.setItem('createdByBackfilled_' + email, '1');
        }
    }).catch(function () {});
}

function getItemDocsFromLocalCache() {
    return readCachedMenuItemsFlat()
        .filter(function (it) { return it && it.id && it.category && it.category.toLowerCase().trim() !== 'water'; })
        .map(function (it) {
            var data = Object.assign({}, it);
            var id = data.id;
            delete data.id;
            return fakeFirestoreDoc(id, data);
        });
}

function getMenuItemFromLocalCache(itemId) {
    var items = readCachedMenuItemsFlat();
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === itemId) return items[i];
    }
    return null;
}

function upsertCachedMenuItem(id, data) {
    if (!id) return;
    var flat = serializableFirestoreData(data);
    var items = readCachedMenuItemsFlat();
    var found = false;
    items = items.map(function (it) {
        if (it.id === id) {
            found = true;
            return Object.assign({ id: id }, flat);
        }
        return it;
    });
    if (!found) items.push(Object.assign({ id: id }, flat));
    writeCachedMenuItemsFlat(items);
    _itemsSnapDocs = getItemDocsFromLocalCache();
}

function removeCachedMenuItem(id) {
    if (!id) return;
    var items = readCachedMenuItemsFlat().filter(function (it) { return it.id !== id; });
    writeCachedMenuItemsFlat(items);
    _itemsSnapDocs = getItemDocsFromLocalCache();
}

/* ============ SALES CACHE (offline dashboard + cashier) ============ */

function readCachedSales() {
    try {
        return JSON.parse(localStorage.getItem('cachedSales') || '[]');
    } catch (e) {
        return [];
    }
}

function writeCachedSales(items) {
    try {
        localStorage.setItem('cachedSales', JSON.stringify(items));
        syncSalesLiveFromCache();
    } catch (e) {}
}

function syncSalesLiveFromCache() {
    _adminSalesLive = readCachedSales().slice();
}

function saleTimestampToMs(item) {
    if (!item) return 0;
    if (item.timestampSeconds != null) return item.timestampSeconds * 1000;
    var ts = item.timestamp;
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts.seconds != null) return ts.seconds * 1000;
    if (ts._seconds != null) return ts._seconds * 1000;
    var parsed = new Date(ts);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function saleEntryFromDoc(doc) {
    var s = doc.data();
    var ts = s.timestamp;
    var timestampSeconds = null;
    if (ts && ts.seconds != null) timestampSeconds = ts.seconds;
    else if (ts && ts._seconds != null) timestampSeconds = ts._seconds;
    else if (ts && typeof ts.toDate === 'function') timestampSeconds = Math.floor(ts.toDate().getTime() / 1000);
    return {
        id: doc.id,
        items: s.items || [],
        total: s.total || 0,
        timestampSeconds: timestampSeconds,
        cashier: s.cashier
    };
}

function upsertCachedSale(entry) {
    var items = readCachedSales();
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === entry.id) { idx = i; break; }
    }
    if (idx >= 0) items[idx] = entry;
    else items.push(entry);
    writeCachedSales(items);
}

function removeCachedSale(id) {
    writeCachedSales(readCachedSales().filter(function (s) { return s.id !== id; }));
}

function mergeSalesSnapIntoCache(snap) {
    if (!snap || snap.empty) return;
    var all = readCachedSales();
    snap.forEach(function (doc) {
        var entry = saleEntryFromDoc(doc);
        var found = false;
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === entry.id) { all[i] = entry; found = true; break; }
        }
        if (!found) all.push(entry);
    });
    writeCachedSales(all);
}

function sumSalesInRange(start, end) {
    var total = 0;
    var count = 0;
    var startMs = start.getTime();
    var endMs = end.getTime();
    readCachedSales().forEach(function (s) {
        var ms = saleTimestampToMs(s);
        if (ms >= startMs && ms < endMs) {
            total += s.total || 0;
            count++;
        }
    });
    return { total: total, count: count };
}

function sumExpensesInRange(start, end) {
    var total = 0;
    var startMs = start.getTime();
    var endMs = end.getTime();
    var isSingleDay = endMs - startMs <= 90000000;
    readCachedExpenses().forEach(function (e) {
        if (isSingleDay && isExpenseOnLocalDay(e, start)) {
            total += e.price || 0;
            return;
        }
        var ms = expenseTimestampToMs(e);
        if (ms >= startMs && ms < endMs) total += e.price || 0;
    });
    return total;
}

function hydrateItemsUiFromCache() {
    var docs = getItemDocsFromLocalCache();
    if (!docs.length) return false;
    _itemsSnapDocs = docs;
    refreshCategoryFilterOptions();
    refreshItemCategoryDropdown();
    var searchEl = document.getElementById('itemSearch');
    var searchTerm = searchEl ? searchEl.value : '';
    renderItemsList(filterItemDocs(_itemsSnapDocs, searchTerm, itemsActiveCategory));
    return true;
}

function warmAdminOfflineCache(done) {
    if (!window.db) {
        if (typeof done === 'function') done();
        return;
    }
    var tasks = [];
    tasks.push(getDocs(collection(db, 'menuItems')).then(function (snap) {
        var menu = [];
        snap.forEach(function (d) {
            menu.push(Object.assign({ id: d.id }, d.data()));
        });
        writeCachedMenuItemsFlat(menu);
    }).catch(function () {}));
    tasks.push(getDocs(collection(db, 'categories')).then(function (snap) {
        var categories = [];
        snap.forEach(function (d) {
            categories.push({ id: d.id, data: d.data() });
        });
        categories.sort(function (a, b) {
            var ao = a.data && a.data.order != null ? Number(a.data.order) : NaN;
            var bo = b.data && b.data.order != null ? Number(b.data.order) : NaN;
            if (!isNaN(ao) && !isNaN(bo) && ao !== bo) return ao - bo;
            if (!isNaN(ao) && isNaN(bo)) return -1;
            if (isNaN(ao) && !isNaN(bo)) return 1;
            return String(a.id || '').localeCompare(String(b.id || ''));
        });
        safeSetItem('cachedCategories', JSON.stringify(categories));
    }).catch(function () {}));
    tasks.push(warmExpensesCacheFromServer());
    tasks.push(warmSalesCacheFromServer());
    Promise.all(tasks).then(function () {
        try { localStorage.setItem('adminCacheWarmedAt', String(Date.now())); } catch (e) {}
        hydrateAdminFromLocalCache();
        if (typeof done === 'function') done();
    }).catch(function () {
        hydrateAdminFromLocalCache();
        if (typeof done === 'function') done();
    });
}

function getDashboardMonth() {
    var sel = document.getElementById('dashboardMonthSelect');
    return sel ? parseInt(sel.value, 10) : new Date().getMonth();
}

function getExpensesMonth() {
    var sel = document.getElementById('expensesMonthSelect');
    return sel ? parseInt(sel.value, 10) : new Date().getMonth();
}

function getSalesDataSource() {
    var cached = readCachedSales();
    if (_adminSalesLive !== null && _adminSalesLive.length) return _adminSalesLive;
    return cached;
}

function syncExpensesLiveFromCache() {
    _adminExpensesLive = readCachedExpenses().slice();
}

function mergeServerExpensesIntoCache(snap) {
    if (_adminResetInProgress) return readCachedExpenses();
    var fromServer = [];
    if (snap && !snap.empty) {
        snap.forEach(function (d) {
            fromServer.push(expenseEntryFromDoc(d));
        });
    }
    var serverIds = {};
    fromServer.forEach(function (e) { serverIds[e.id] = true; });
    var pending = readCachedExpenses().filter(function (e) {
        return String(e.id).indexOf('local-') === 0 && !serverIds[e.id];
    });
    var merged = fromServer.concat(pending).map(normalizeExpenseEntry);
    _adminExpensesLive = merged;
    writeCachedExpenses(merged);
    return merged;
}

function getExpensesDataSource() {
    var cached = readCachedExpenses();
    if (_adminExpensesLive !== null && _adminExpensesLive.length) return _adminExpensesLive;
    return cached;
}

function deriveExpenseTimestampSeconds(entry) {
    if (!entry) return null;
    if (entry.timestampSeconds != null && !isNaN(entry.timestampSeconds)) {
        return entry.timestampSeconds;
    }
    if (entry.date && entry.time) {
        var d = new Date(entry.date + 'T' + entry.time);
        if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
    }
    var ts = entry.timestamp;
    if (typeof ts === 'string') {
        var p = new Date(ts);
        if (!isNaN(p.getTime())) return Math.floor(p.getTime() / 1000);
    }
    if (ts && ts.seconds != null) return ts.seconds;
    if (ts && ts._seconds != null) return ts._seconds;
    if (ts && typeof ts.toDate === 'function') return Math.floor(ts.toDate().getTime() / 1000);
    return null;
}

function normalizeExpenseEntry(entry) {
    if (!entry) return entry;
    var sec = deriveExpenseTimestampSeconds(entry);
    if (sec != null) entry.timestampSeconds = sec;
    if (!entry.date && entry.timestampSeconds) {
        entry.date = getLocalDateKey(new Date(entry.timestampSeconds * 1000));
    }
    if (!entry.time && entry.timestampSeconds) {
        var td = new Date(entry.timestampSeconds * 1000);
        entry.time = pad2Local(td.getHours()) + ':' + pad2Local(td.getMinutes());
    }
    return entry;
}

function pad2Local(n) {
    return String(n).padStart(2, '0');
}

function getLocalDateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2Local(d.getMonth() + 1) + '-' + pad2Local(d.getDate());
}

function expenseCalendarDateKey(item) {
    if (!item) return '';
    if (item.date) return String(item.date).slice(0, 10);
    var sec = deriveExpenseTimestampSeconds(item);
    return sec != null ? getLocalDateKey(new Date(sec * 1000)) : '';
}

function isExpenseOnLocalDay(item, dayStart) {
    return expenseCalendarDateKey(item) === getLocalDateKey(dayStart);
}

function isExpenseInMonth(item, month, year) {
    year = year == null ? new Date().getFullYear() : year;
    var key = expenseCalendarDateKey(item);
    if (key) {
        var parts = key.split('-');
        return parseInt(parts[0], 10) === year && parseInt(parts[1], 10) - 1 === month;
    }
    var ms = deriveExpenseTimestampSeconds(item);
    if (ms == null) return false;
    var d = new Date(ms * 1000);
    return d.getFullYear() === year && d.getMonth() === month;
}

function mergeServerSalesIntoCache(snap) {
    if (_adminResetInProgress) return readCachedSales();
    var fromServer = [];
    if (snap && !snap.empty) {
        snap.forEach(function (d) {
            fromServer.push(saleEntryFromDoc(d));
        });
    }
    var serverIds = {};
    fromServer.forEach(function (s) { serverIds[s.id] = true; });
    var pending = readCachedSales().filter(function (s) {
        return String(s.id).indexOf('local-') === 0 && !serverIds[s.id];
    });
    var merged = fromServer.concat(pending);
    _adminSalesLive = merged;
    writeCachedSales(merged);
    return merged;
}

function mergeRestExpensesDocs(docs) {
    if (_adminResetInProgress) return readCachedExpenses();
    var fromServer = restDocsToExpenses(docs || []);
    var serverIds = {};
    fromServer.forEach(function (e) { serverIds[e.id] = true; });
    var pending = readCachedExpenses().filter(function (e) {
        return String(e.id).indexOf('local-') === 0 && !serverIds[e.id];
    });
    var merged = fromServer.concat(pending).map(normalizeExpenseEntry);
    _adminExpensesLive = merged;
    writeCachedExpenses(merged);
    return merged;
}

function mergeRestSalesDocs(docs) {
    if (_adminResetInProgress) return readCachedSales();
    var fromServer = restDocsToSales(docs || []);
    var serverIds = {};
    fromServer.forEach(function (s) { serverIds[s.id] = true; });
    var pending = readCachedSales().filter(function (s) {
        return String(s.id).indexOf('local-') === 0 && !serverIds[s.id];
    });
    var merged = fromServer.concat(pending);
    _adminSalesLive = merged;
    writeCachedSales(merged);
    return merged;
}

function clearAdminSalesExpensesCache() {
    _adminSalesLive = [];
    _adminExpensesLive = [];
    writeCachedSales([]);
    writeCachedExpenses([]);
}

function hydrateAdminFromLocalCache() {
    var sales = readCachedSales();
    var expenses = readCachedExpenses();
    if (sales.length > 0) _adminSalesLive = sales;
    if (expenses.length > 0) _adminExpensesLive = expenses;
}

function isFirestoreCacheEmptySnap(snap) {
    return !!(snap && snap.empty && snap.metadata && snap.metadata.fromCache);
}

function fetchPublicCollectionViaRest(collectionName, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId || !cfg.apiKey) {
        return Promise.reject(new Error('No config'));
    }
    var baseUrl = getFirestoreRestBaseUrl();
    var url = baseUrl + encodeURIComponent(cfg.projectId) +
        '/databases/(default)/documents/' + encodeURIComponent(collectionName) +
        '?key=' + encodeURIComponent(cfg.apiKey);
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
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
    }).then(parseRestDocuments).catch(function (e) {
        if (timer) clearTimeout(timer);
        if (isFirestoreApiDisabledError(e)) showFirestoreApiDisabledAlert();
        throw e;
    });
}

function mapAdminRestMenuItem(d) {
    var data = (d && d.data) || d || {};
    return {
        id: d.id,
        name_ku: data.name_ku || '',
        name_ar: data.name_ar || '',
        name_en: data.name_en || '',
        price: data.price || 0,
        category: data.category || '',
        image: data.image || '',
        available: data.available !== false,
        description_ku: data.description_ku || '',
        description_ar: data.description_ar || '',
        description_en: data.description_en || '',
        group_ku: data.group_ku || '',
        group_ar: data.group_ar || '',
        group_en: data.group_en || '',
        updated_at: data.updated_at || '',
        createdBy: data.createdBy || ''
    };
}

function fetchMenuItemsForAdmin(timeoutMs) {
    if (window._firestoreApiDisabled) return Promise.resolve([]);
    timeoutMs = timeoutMs || 12000;

    function viaPublicRest() {
        if (typeof fetchMenuViaRest !== 'function') return Promise.resolve([]);
        return fetchMenuViaRest(timeoutMs).catch(function () { return []; });
    }

    // Auth REST can hang/fail on cold mobile open before auth settles — fall back to public REST.
    if (isAdminAuthenticated() && typeof fetchAllAdminCollectionViaRest === 'function') {
        return fetchAllAdminCollectionViaRest('menuItems', timeoutMs).then(function (docs) {
            return docs.map(mapAdminRestMenuItem);
        }).catch(function () {
            return viaPublicRest();
        });
    }
    return viaPublicRest();
}

function fetchCategoriesForAdmin(timeoutMs) {
    if (window._firestoreApiDisabled) return Promise.resolve([]);
    return fetchPublicCollectionViaRest('categories', timeoutMs).then(function (docs) {
        return docs.map(function (d) { return { id: d.id, data: d.data || {} }; }).sort(function (a, b) {
            var ao = (a.data && a.data.order) != null ? a.data.order : null;
            var bo = (b.data && b.data.order) != null ? b.data.order : null;
            if (ao != null && bo != null) return ao - bo;
            if (ao != null) return -1;
            if (bo != null) return 1;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    });
}

function restFieldValue(field) {
    if (!field) return null;
    if ('stringValue' in field) return field.stringValue;
    if ('integerValue' in field) return parseInt(field.integerValue, 10);
    if ('doubleValue' in field) return field.doubleValue;
    if ('booleanValue' in field) return field.booleanValue;
    if ('timestampValue' in field) return field.timestampValue;
    if ('arrayValue' in field) {
        return (field.arrayValue.values || []).map(restFieldValue);
    }
    if ('mapValue' in field) {
        var o = {};
        var fields = field.mapValue.fields || {};
        Object.keys(fields).forEach(function (k) { o[k] = restFieldValue(fields[k]); });
        return o;
    }
    return null;
}

function parseRestDocuments(json) {
    var docs = [];
    (json.documents || []).forEach(function (doc) {
        var parts = (doc.name || '').split('/');
        var id = parts[parts.length - 1];
        var data = {};
        var fields = doc.fields || {};
        Object.keys(fields).forEach(function (k) { data[k] = restFieldValue(fields[k]); });
        docs.push({ id: id, data: data });
    });
    return docs;
}

function fetchAdminCollectionViaRest(collectionName, timeoutMs) {
    if (window._firestoreApiDisabled) return Promise.resolve([]);
    return fetchAllAdminCollectionViaRest(collectionName, timeoutMs);
}

function getFirestoreRestBaseUrl() {
    var emulatorInfo = window._firestoreEmulatorInfo;
    if (emulatorInfo) {
        return 'http://' + emulatorInfo.host + ':' + emulatorInfo.port + '/v1/projects/';
    }
    return 'https://firestore.googleapis.com/v1/projects/';
}

function fetchAllAdminCollectionViaRest(collectionName, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    if (!isAdminAuthenticated()) return Promise.reject(new Error('Not signed in'));
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId) return Promise.reject(new Error('No config'));

    function fetchPage(pageToken) {
        return auth.currentUser.getIdToken().then(function (token) {
            var baseUrl = getFirestoreRestBaseUrl();
            var url = baseUrl + encodeURIComponent(cfg.projectId) +
                '/databases/(default)/documents/' + encodeURIComponent(collectionName);
            if (pageToken) url += '?pageToken=' + encodeURIComponent(pageToken);
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = null;
            var opts = { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } };
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
                        } else if (body) {
                            msg += ': ' + body.slice(0, 160);
                        }
                        throw new Error(msg);
                    });
                }
                return r.json();
            }).then(function (json) {
                var docs = parseRestDocuments(json);
                if (json.nextPageToken) {
                    return fetchPage(json.nextPageToken).then(function (more) {
                        return docs.concat(more);
                    });
                }
                return docs;
            }).catch(function (e) {
                if (timer) clearTimeout(timer);
                throw e;
            });
        });
    }

    return fetchPage(null).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        throw err;
    });
}

function deleteCollectionDocumentsByIds(collectionName, docIds) {
    if (!docIds || !docIds.length) return Promise.resolve();
    if (!window.db) return Promise.reject(new Error('Firestore not ready'));

    var promises = [];
    for (var i = 0; i < docIds.length; i += 500) {
        var batch = writeBatch(db);
        var chunk = docIds.slice(i, i + 500);
        chunk.forEach(function (id) {
            batch.delete(doc(db, collectionName, id));
        });
        promises.push(batch.commit());
    }
    return Promise.all(promises);
}

function deleteAdminCollectionFromServer(collectionName) {
    return fetchAllAdminCollectionViaRest(collectionName).then(function (docs) {
        var ids = (docs || []).map(function (d) { return d.id; }).filter(Boolean);
        if (!ids.length) return { deleted: 0, remaining: 0 };
        return deleteCollectionDocumentsByIds(collectionName, ids).then(function () {
            return fetchAllAdminCollectionViaRest(collectionName).then(function (remaining) {
                return { deleted: ids.length, remaining: (remaining || []).length };
            });
        });
    });
}

function promiseWithTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error(message || 'timeout')); }, ms);
        })
    ]);
}

function jsToRestFields(obj) {
    var fields = {};
    Object.keys(obj || {}).forEach(function (key) {
        var v = obj[key];
        if (v === undefined || v === null) return;
        if (typeof v === 'string') {
            fields[key] = { stringValue: v };
        } else if (typeof v === 'boolean') {
            fields[key] = { booleanValue: v };
        } else if (typeof v === 'number' && !isNaN(v)) {
            if (Number.isInteger(v)) fields[key] = { integerValue: String(v) };
            else fields[key] = { doubleValue: v };
        }
    });
    return fields;
}

function writeDocumentViaRest(collectionName, docId, plainData, isCreate) {
    if (!isAdminAuthenticated()) return Promise.reject(new Error('Not signed in'));
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId) return Promise.reject(new Error('No config'));
    var payload = { fields: jsToRestFields(plainData) };
    return auth.currentUser.getIdToken().then(function (token) {
        var base = getFirestoreRestBaseUrl() + encodeURIComponent(cfg.projectId) +
            '/databases/(default)/documents/' + encodeURIComponent(collectionName);
        var url = isCreate
            ? base + '?documentId=' + encodeURIComponent(docId)
            : base + '/' + encodeURIComponent(docId);
        return fetch(url, {
            method: isCreate ? 'POST' : 'PATCH',
            cache: 'no-store',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }).then(function (r) {
            if (!r.ok) {
                return r.text().then(function (t) {
                    throw new Error('REST HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
                });
            }
            return r.json();
        });
    });
}

function deleteDocumentViaRest(collectionName, docId) {
    if (!isAdminAuthenticated()) return Promise.reject(new Error('Not signed in'));
    var cfg = window.firebaseConfig;
    if (!cfg || !cfg.projectId) return Promise.reject(new Error('No config'));
    return auth.currentUser.getIdToken().then(function (token) {
        var url = getFirestoreRestBaseUrl() + encodeURIComponent(cfg.projectId) +
            '/databases/(default)/documents/' + encodeURIComponent(collectionName) + '/' +
            encodeURIComponent(docId);
        return fetch(url, {
            method: 'DELETE',
            cache: 'no-store',
            headers: { Authorization: 'Bearer ' + token }
        }).then(function (r) {
            if (!r.ok && r.status !== 404) {
                return r.text().then(function (t) {
                    throw new Error('REST HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
                });
            }
            return true;
        });
    });
}

/** Menu writes: SDK first (8s), then Firestore REST — mobile SDK often hangs. */
function applyMenuCloudWrite(config) {
    if (!config || !config.onDone) return;

    if (!navigator.onLine) {
        applyWrite(config.sdkPromise, config.onDone, config.onError, {});
        return;
    }

    function restFallback(err) {
        console.warn('[menu cloud write] SDK failed, REST fallback:', err && (err.message || err));
        var restPromise;
        if (config.isDelete) {
            restPromise = deleteDocumentViaRest(config.collection, config.docId);
        } else {
            restPromise = writeDocumentViaRest(
                config.collection,
                config.docId,
                config.plainData,
                !!config.isCreate
            );
        }
        restPromise.then(function () {
            config.onDone(false);
        }).catch(function (e) {
            if (typeof config.onError === 'function') config.onError(e);
        });
    }

    if (!config.sdkPromise || typeof config.sdkPromise.then !== 'function') {
        restFallback(new Error('No SDK promise'));
        return;
    }

    promiseWithTimeout(config.sdkPromise, 8000, 'SDK write timeout').then(function () {
        config.onDone(false);
    }).catch(restFallback);
}

function restDocsToSales(docs) {
    return docs.map(function (d) {
        var ts = d.data.timestamp;
        var timestampSeconds = null;
        if (typeof ts === 'string') {
            var parsed = new Date(ts);
            if (!isNaN(parsed.getTime())) timestampSeconds = Math.floor(parsed.getTime() / 1000);
        }
        return {
            id: d.id,
            items: d.data.items || [],
            total: d.data.total || 0,
            timestampSeconds: timestampSeconds,
            cashier: d.data.cashier
        };
    });
}

function restDocsToExpenses(docs) {
    return docs.map(function (d) {
        var ts = d.data.timestamp;
        var timestampSeconds = null;
        if (typeof ts === 'string') {
            var parsed = new Date(ts);
            if (!isNaN(parsed.getTime())) timestampSeconds = Math.floor(parsed.getTime() / 1000);
        }
        return normalizeExpenseEntry({
            id: d.id,
            name: d.data.name,
            price: d.data.price || 0,
            date: d.data.date,
            time: d.data.time,
            timestamp: ts,
            timestampSeconds: timestampSeconds
        });
    });
}

function warmSalesCacheFromServer() {
    if (_adminResetInProgress) {
        writeCachedSales([]);
        return Promise.resolve();
    }
    if (window._firestoreApiDisabled) return Promise.resolve();
    if (USE_LOCAL_API) {
        return localApiRequest('sales.php').then(function(docs) {
            mergeRestSalesDocs(docs || []);
        }).catch(function(err) {
            console.warn('[sales] Local API failed:', err.message);
        });
    }
    if (isAdminAuthenticated() && navigator.onLine) {
        return fetchAllAdminCollectionViaRest('sales').then(function (docs) {
            mergeRestSalesDocs(docs || []);
        }).catch(function (err) {
            if (isFirestoreApiDisabledError(err)) {
                showFirestoreApiDisabledAlert();
            }
            return salesCacheFromSdkServer();
        });
    }
    return salesCacheFromSdkServer();
}

function salesCacheFromSdkServer() {
    return getDocs(collection(db, 'sales'), { source: 'server' }).then(function (snap) {
        var sales = [];
        snap.forEach(function (d) { sales.push(saleEntryFromDoc(d)); });
        writeCachedSales(sales);
    }).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        return getDocs(collection(db, 'sales')).then(function (snap) {
            var sales = [];
            snap.forEach(function (d) { sales.push(saleEntryFromDoc(d)); });
            writeCachedSales(sales);
        }).catch(function () {
            writeCachedSales([]);
        });
    });
}

function warmExpensesCacheFromServer() {
    if (_adminResetInProgress) {
        writeCachedExpenses([]);
        return Promise.resolve();
    }
    if (window._firestoreApiDisabled) return Promise.resolve();
    if (USE_LOCAL_API) {
        return localApiRequest('expenses.php').then(function(docs) {
            mergeRestExpensesDocs(docs || []);
        }).catch(function(err) {
            console.warn('[expenses] Local API failed:', err.message);
        });
    }
    if (isAdminAuthenticated() && navigator.onLine) {
        return fetchAllAdminCollectionViaRest('expenses').then(function (docs) {
            mergeRestExpensesDocs(docs || []);
        }).catch(function (err) {
            if (isFirestoreApiDisabledError(err)) {
                showFirestoreApiDisabledAlert();
            }
            return expensesCacheFromSdkServer();
        });
    }
    return expensesCacheFromSdkServer();
}

function expensesCacheFromSdkServer() {
    return getDocs(collection(db, 'expenses'), { source: 'server' }).then(function (snap) {
        var expenses = [];
        snap.forEach(function (d) { expenses.push(expenseEntryFromDoc(d)); });
        writeCachedExpenses(expenses);
    }).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        return getDocs(collection(db, 'expenses')).then(function (snap) {
            var expenses = [];
            snap.forEach(function (d) { expenses.push(expenseEntryFromDoc(d)); });
            writeCachedExpenses(expenses);
        }).catch(function () {
            writeCachedExpenses([]);
        });
    });
}

function shouldIgnoreCachedFirestoreSnap(snap) {
    return !!(navigator.onLine &&
        isAdminAuthenticated() &&
        snap &&
        snap.metadata &&
        snap.metadata.fromCache &&
        !snap.metadata.hasPendingWrites);
}

function syncAdminFinancialsFromServer(callback) {
    if (!isAdminAuthenticated() || !navigator.onLine) {
        if (typeof callback === 'function') callback();
        return Promise.resolve();
    }
    return Promise.all([
        warmSalesCacheFromServer(),
        warmExpensesCacheFromServer()
    ]).then(function () {
        syncSalesLiveFromCache();
        syncExpensesLiveFromCache();
        refreshAdminCurrentSection();
        if (typeof callback === 'function') callback();
    }).catch(function (err) {
        console.warn('[sync] financials:', err && err.message ? err.message : err);
        if (typeof callback === 'function') callback();
    });
}

function scheduleAdminRestFallback() {
    if (window._firestoreApiDisabled) return;
    setTimeout(function () {
        if (!isAdminAuthenticated()) return;
        if (_adminSalesLive === null) {
            fetchAdminCollectionViaRest('sales').then(function (docs) {
                mergeRestSalesDocs(docs);
                refreshAdminCurrentSection();
            }).catch(function (e) {
                console.warn('[REST] sales fallback:', e.message || e);
                _adminSalesLive = readCachedSales();
                refreshAdminCurrentSection();
            });
        }
        if (_adminExpensesLive === null) {
            fetchAdminCollectionViaRest('expenses').then(function (docs) {
                mergeRestExpensesDocs(docs);
                refreshAdminCurrentSection();
            }).catch(function (e) {
                console.warn('[REST] expenses fallback:', e.message || e);
                _adminExpensesLive = readCachedExpenses();
                refreshAdminCurrentSection();
            });
        }
    }, 4000);
}

function startAdminLiveListeners() {
    hydrateAdminFromLocalCache();
    refreshAdminCurrentSection();

    if (_adminLiveListenersStarted || !window.db) return;
    if (!isAdminAuthenticated()) {
        if (!navigator.onLine) _adminLiveListenersStarted = true;
        return;
    }
    _adminLiveListenersStarted = true;

    if (navigator.onLine) {
        fetchAdminCollectionViaRest('sales').then(function (docs) {
            mergeRestSalesDocs(docs || []);
            refreshAdminCurrentSection();
        }).catch(function (e) { console.warn('[REST] sales:', e.message || e); });

        fetchAdminCollectionViaRest('expenses').then(function (docs) {
            mergeRestExpensesDocs(docs || []);
            refreshAdminCurrentSection();
        }).catch(function (e) { console.warn('[REST] expenses:', e.message || e); });
    }

    function applySalesSnap(snap) {
        if (_adminResetInProgress) return;
        if (shouldIgnoreCachedFirestoreSnap(snap)) return;
        if (snap.empty) {
            if (isFirestoreCacheEmptySnap(snap)) {
                hydrateAdminFromLocalCache();
            } else {
                var cachedSales = readCachedSales();
                var pendingSales = cachedSales.filter(function (s) { return String(s.id).indexOf('local-') === 0; });
                if (pendingSales.length) {
                    _adminSalesLive = pendingSales;
                    writeCachedSales(pendingSales);
                } else if (!cachedSales.length) {
                    _adminSalesLive = [];
                    writeCachedSales([]);
                }
            }
            refreshAdminCurrentSection();
            return;
        }
        mergeServerSalesIntoCache(snap);
        if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());
        if (document.getElementById('recentSalesContainer')) renderRecentSalesUI();
    }

    function applyExpensesSnap(snap) {
        if (_adminResetInProgress) return;
        if (shouldIgnoreCachedFirestoreSnap(snap)) return;
        if (snap.empty) {
            if (isFirestoreCacheEmptySnap(snap)) {
                hydrateAdminFromLocalCache();
            } else {
                var cached = readCachedExpenses();
                var pending = cached.filter(function (e) { return String(e.id).indexOf('local-') === 0; });
                if (pending.length) {
                    _adminExpensesLive = pending;
                    writeCachedExpenses(pending);
                } else if (!cached.length) {
                    _adminExpensesLive = [];
                    writeCachedExpenses([]);
                }
            }
            refreshAdminCurrentSection();
            return;
        }
        mergeServerExpensesIntoCache(snap);
        if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());
        if (document.getElementById('expensesList')) renderExpensesUI(getExpensesMonth());
    }

    var salesUnsub = onSnapshot(collection(db, 'sales'), applySalesSnap, function (e) {
        console.error('[live] sales error:', e);
        hydrateAdminFromLocalCache();
        refreshAdminCurrentSection();
    });
    dashboardUnsubscribes.push(salesUnsub);

    var expUnsub = onSnapshot(collection(db, 'expenses'), applyExpensesSnap, function (e) {
        console.error('[live] expenses error:', e);
        hydrateAdminFromLocalCache();
        refreshAdminCurrentSection();
    });
    dashboardUnsubscribes.push(expUnsub);

    if (navigator.onLine) scheduleAdminRestFallback();
}

function isAdminAuthenticated() {
    if (USE_LOCAL_API) {
        var token = window.currentAuthToken || localStorage.getItem('adminAuthToken');
        var user = window.currentUser || localStorage.getItem('adminUser');
        return !!(token && user);
    }
    return !!(window.auth && auth.currentUser);
}

function isFirestoreApiDisabledError(err) {
    if (!err || !err.message) return false;
    var m = err.message;
    var disabled = m.indexOf('Cloud Firestore API has not been used in project') !== -1 ||
        m.indexOf('SERVICE_DISABLED') !== -1 ||
        m.indexOf('firestore.googleapis.com/overview') !== -1 ||
        (m.indexOf('firestore.googleapis.com') !== -1 && m.indexOf('disabled') !== -1);
    if (disabled) {
        window._firestoreApiDisabled = true;
    }
    return disabled;
}

function isFirestorePermissionError(err) {
    if (!err || !err.message) return false;
    var msg = err.message.toLowerCase();
    return msg.indexOf('permission') !== -1 ||
        msg.indexOf('insufficient') !== -1 ||
        err.code === 'permission-denied' ||
        err.code === 'PERMISSION_DENIED' ||
        msg.indexOf('app check') !== -1 ||
        msg.indexOf('appcheck') !== -1;
}

function showFirestoreApiDisabledAlert() {
    if (window._firestoreApiDisabledAlerted) return;
    window._firestoreApiDisabledAlerted = true;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var projectId = (window.firebaseConfig && window.firebaseConfig.projectId) || 'brew-coffee-1cd84';
    var url = 'https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=' + encodeURIComponent(projectId);
    alert('⚠️ ' + (S.errorPrefix || 'Error:') + '\n\nCloud Firestore API is disabled for this project.\n\nPlease enable it here:\n' + url + '\n\nAfter enabling, wait a few minutes and refresh this page.');
}

var _adminAuthInitialized = false;
window.adminAuthReady = new Promise(function (resolve) {
    if (USE_LOCAL_API) {
        _adminAuthInitialized = true;
        var storedToken = localStorage.getItem('adminAuthToken');
        var storedUser = localStorage.getItem('adminUser');
        if (storedToken && storedUser) {
            try {
                window.currentAuthToken = storedToken;
                window.currentUser = JSON.parse(storedUser);
                resolve(window.currentUser);
                syncAdminFinancialsFromServer();
                warmAdminOfflineCache();
                startAdminLiveListeners();
                refreshAdminCurrentSection();
            } catch (e) {
                localStorage.removeItem('adminAuthToken');
                localStorage.removeItem('adminUser');
                resolve(null);
                if (navigator.onLine) {
                    window.location.href = 'login.html';
                } else {
                    hydrateAdminFromLocalCache();
                    refreshAdminCurrentSection();
                }
            }
        } else {
            resolve(null);
            if (navigator.onLine) {
                window.location.href = 'login.html';
            } else {
                hydrateAdminFromLocalCache();
                refreshAdminCurrentSection();
            }
        }
        return;
    }
    
    if (!window.auth) {
        resolve(null);
        return;
    }
    auth.onAuthStateChanged(function (user) {
        if (!_adminAuthInitialized) {
            _adminAuthInitialized = true;
            resolve(user);
        }
        if (user) {
            syncAdminFinancialsFromServer();
            warmAdminOfflineCache();
            startAdminLiveListeners();
            refreshAdminCurrentSection();
        } else if (!navigator.onLine) {
            hydrateAdminFromLocalCache();
            refreshAdminCurrentSection();
        } else if (navigator.onLine) {
            window.location.href = 'login.html';
        }
    });
});

function whenAdminReady(fn) {
    var dbP = window.dbReady || Promise.resolve(window.db);
    return Promise.all([dbP, window.adminAuthReady]).then(function (results) {
        if (typeof fn === 'function') fn(results[1]);
    });
}

/** Plain Firestore read for sales/expenses — only after login (rules require auth). */
function adminProtectedGet(queryOrRef) {
    if (!isAdminAuthenticated()) {
        return Promise.reject(new Error('Not signed in'));
    }
    return queryOrRef.get();
}

function adminGetWithTimeout(queryOrRef, ms) {
    ms = ms || (navigator.onLine ? 10000 : 8000);

    // Modular SDK: callers often pass getDocs(...)/getDoc(...) promises directly
    if (queryOrRef && typeof queryOrRef.then === 'function') {
        return Promise.race([
            queryOrRef,
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error('Connection timeout')); }, ms);
            })
        ]).catch(function (err) {
            if (isFirestoreApiDisabledError(err)) showFirestoreApiDisabledAlert();
            throw err;
        });
    }

    var cacheSnap = null;

    function raceServer() {
        return Promise.race([
            queryOrRef.get({ source: 'server' }),
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error('Connection timeout')); }, ms);
            })
        ]);
    }

    return queryOrRef.get({ source: 'cache' }).then(function (snap) {
        cacheSnap = snap;
        if (snap && !snap.empty) {
            return raceServer().then(function (serverSnap) {
                return serverSnap;
            }).catch(function () {
                return snap;
            });
        }
        return raceServer();
    }).catch(function (err) {
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        if (cacheSnap && !cacheSnap.empty) return cacheSnap;
        throw err;
    });
}

function snapExists(snap) {
    if (!snap) return false;
    return typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
}

function setAdminModalOpen(isOpen) {
    try {
        document.body.classList.toggle('admin-modal-open', !!isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
    } catch (e) { /* ignore */ }
}

function openAdminModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('active');
    setAdminModalOpen(true);
}

function closeAdminModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) {
        setAdminModalOpen(false);
    }
}

function refreshAdminCurrentSection() {
    var activeBtn = document.querySelector('.admin-nav-btn.active');
    if (!activeBtn) return;
    var section = activeBtn.getAttribute('data-section');
    if (section === 'dashboard' && document.getElementById('todaySales')) {
        renderDashboardUI(getDashboardMonth());
        renderRecentSalesUI();
    } else if (section === 'expenses' && document.getElementById('expensesList')) {
        renderExpensesUI(getExpensesMonth());
    } else if (section === 'items' && document.getElementById('itemsList')) {
        // Retry paint after auth/db ready without rebuilding the whole section UI.
        loadItemsList();
    } else if (section === 'categories' && document.getElementById('categoriesList')) {
        loadCategoriesList();
    }
}

function whenAdminDbReady(fn) {
    return whenAdminReady(fn);
}

function clearAdminLoadingEl(elementId, html) {
    var el = document.getElementById(elementId);
    if (!el) return;
    if (el.querySelector('.loading')) {
        el.innerHTML = html || '';
    }
}

function adminSectionStillLoading(elementId) {
    var el = document.getElementById(elementId);
    return !!(el && el.querySelector('.loading'));
}

function stopCategoriesListener() {
    if (categoriesUnsubscribe) {
        try { categoriesUnsubscribe(); } catch (e) {}
        categoriesUnsubscribe = null;
    }
}

window.initAdminPanel = initAdminPanel;
window.loadAdminSection = loadAdminSection;
window.loadDashboard = loadDashboard;
window.editItem = editItem;
window.deleteItem = deleteItem;
window.saveItem = saveItem;
window.loadCashier = loadCashier;
window.loadExpenses = loadExpenses;
window.loadSettings = loadSettings;
window.handleLogout = handleLogout;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.saveCategory = saveCategory;
window.printReceipt = printReceipt;
window.setupAdminOfflineDetection = setupAdminOfflineDetection;
window.populateTestData = populateTestData;

document.addEventListener('DOMContentLoaded', function () {
    setupAdminOfflineDetection();
    hydrateAdminFromLocalCache();

    var LOGO_CANDIDATES = [
        'images/Brew-logo.png',
        'images/zayed-logo.png',
        'assets/icon-512.png',
        'assets/logo.svg'
    ];
    window.fallbackLogo = function (img) {
        if (!img || !(img instanceof HTMLImageElement)) return;
        if (img.dataset.logoFallbackDone === '1') return;
        var next = parseInt(img.dataset.logoTry || '1', 10);
        if (next < LOGO_CANDIDATES.length) {
            img.dataset.logoTry = String(next + 1);
            img.src = LOGO_CANDIDATES[next] + '?v=83';
            return;
        }
        img.dataset.logoFallbackDone = '1';
        img.onerror = null;
        img.style.display = 'none';
        var wrap = img.closest('.sidebar-brand') || img.parentElement;
        if (wrap && !wrap.querySelector('.logo-fallback-initials')) {
            var fallback = document.createElement('span');
            fallback.className = 'logo-fallback-initials';
            fallback.textContent = 'AC';
            fallback.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#3B82F6,#1D4ED8);color:#fff;font-weight:800;font-size:1.1rem;font-family:var(--font-body);flex-shrink:0;border:2px solid rgba(59,130,246,0.35);box-shadow:0 2px 12px rgba(59,130,246,0.25);';
            wrap.insertBefore(fallback, wrap.firstChild);
        }
    };

    applyAdminAccent(localStorage.getItem('adminAccent') || 'sapphire');
    initAdminPanel();
    wireAdminLangButtons();
    initSidebar();

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (!isAdminAuthenticated() || !navigator.onLine) return;
        syncAdminFinancialsFromServer();
    });

});

function wireAdminLangButtons() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    document.documentElement.dir = (lang === 'ar' || lang === 'ku') ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.querySelectorAll('.admin-lang-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
        btn.addEventListener('click', function () {
            var l = this.getAttribute('data-lang');
            localStorage.setItem('selectedLang', l);
            document.querySelectorAll('.admin-lang-btn').forEach(function (b) { b.classList.remove('active'); });
            this.classList.add('active');
            document.documentElement.dir = (l === 'ar' || l === 'ku') ? 'rtl' : 'ltr';
            document.documentElement.lang = l;
            if (window.applyLanguageUI) applyLanguageUI(l);
        });
    });
}

function initSidebar() {
    var sidebar = document.getElementById('adminSidebar');
    var hamburger = document.getElementById('sidebarHamburger');
    var closeBtn = document.getElementById('sidebarClose');
    var overlay = document.getElementById('sidebarOverlay');

    if (!sidebar) return;

    function openSidebar() {
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (hamburger) {
        hamburger.addEventListener('click', function (e) {
            e.stopPropagation();
            openSidebar();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            closeSidebar();
        });
    }

    if (overlay) {
        overlay.addEventListener('click', function () {
            closeSidebar();
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });
}

function initAdminPanel() {
    maybeRunCategoryCleanup();
    maybeRunCategoryRename();
    var navButtons = document.querySelectorAll('.admin-nav-btn');
    navButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            navButtons.forEach(function (b) { b.classList.remove('active'); });
            this.classList.add('active');
            var section = this.getAttribute('data-section');
            loadAdminSection(section);
            var headerTitle = document.querySelector('.admin-header h1');
            if (headerTitle) {
                var label = this.querySelector('span:last-child');
                headerTitle.textContent = label ? label.textContent.trim() : this.textContent.trim();
            }
            var sidebar = document.getElementById('adminSidebar');
            var overlay = document.getElementById('sidebarOverlay');
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });

    // Tap outside modal / Escape closes topmost admin modal
    document.addEventListener('click', function (e) {
        if (!e.target || !e.target.classList || !e.target.classList.contains('modal-overlay')) return;
        if (!e.target.classList.contains('active')) return;
        closeAdminModal(e.target);
        if (e.target.id === 'itemModal') activeItemModal = null;
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var openModals = document.querySelectorAll('.modal-overlay.active');
        if (!openModals.length) return;
        var top = openModals[openModals.length - 1];
        closeAdminModal(top);
        if (top && top.id === 'itemModal') activeItemModal = null;
    });

    var defaultBtn = document.querySelector('.admin-nav-btn.active');
    var initialSection = defaultBtn
        ? defaultBtn.getAttribute('data-section')
        : 'items';
    if (!defaultBtn) {
        var fallbackBtn = document.querySelector('.admin-nav-btn[data-section="items"]');
        if (fallbackBtn) fallbackBtn.classList.add('active');
    }

    // Wait for auth + Firestore before first section load (fixes mobile infinite spinner).
    var bootContent = document.getElementById('adminContent');
    var bootS = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (bootContent && !bootContent.querySelector('.card')) {
        bootContent.innerHTML = '<div class="loading">' + (bootS.loading || 'Loading...') + '</div>';
    }
    whenAdminReady(function () {
        startAdminLiveListeners();
        loadAdminSection(initialSection);
    });
}

function loadAdminSection(section) {
    if (section !== 'cashier') {
        stopCashierListener();
    }
    if (section !== 'categories') {
        stopCategoriesListener();
    }
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    if (!adminContent) return;
    adminContent.innerHTML = '<div class="loading">' + S.loading + '</div>';

    try {
        if (section === 'dashboard') { loadDashboard(); }
        else if (section === 'items') { loadManageItems(); }
        else if (section === 'categories') { loadManageCategories(); }
        else if (section === 'offers') { loadManageOffers(); }
        else if (section === 'cashier') { loadCashier(); }
        else if (section === 'expenses') { loadExpenses(); }
        else if (section === 'settings') { loadSettings(); }
        else if (section === 'logout') { handleLogout(); }
        else { adminContent.innerHTML = '<p>' + S.sectionNotFound + '</p>'; }
    } catch (error) {
        console.error(S.errorLoadingSection + section + ':', error);
        adminContent.innerHTML = '<p style="color:#C62828;padding:20px;">' + S.errorPrefix + error.message + '</p>';
    }
}

function toDisplayTime(ts) {
    if (!ts) return '\u2014';
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var locale = lang === 'ar' ? 'ar-IQ' : (lang === 'ku' ? 'ku-IQ' : 'en-US');

    function format12(dateObj) {
        if (!dateObj || isNaN(dateObj.getTime())) return '\u2014';
        return dateObj.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    }

    if (ts instanceof Date) return format12(ts);
    if (typeof ts.toDate === 'function') return format12(ts.toDate());
    if (ts.seconds != null) return format12(new Date(ts.seconds * 1000));
    if (ts._seconds != null) return format12(new Date(ts._seconds * 1000));
    return String(ts);
}

/* ============ DASHBOARD ============ */

function getMonthName(monthIndex, strings) {
    var keys = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    return (monthIndex + 1) + ' — ' + (strings[keys[monthIndex]] || (monthIndex + 1));
}

function loadDashboard() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    var now = new Date();
    var currentMonth = now.getMonth();
    var monthsHtml = '';
    var mNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (var m = 0; m < 12; m++) {
        monthsHtml += '<option value="' + m + '"' + (m === currentMonth ? ' selected' : '') + '>' + (m + 1) + ' — ' + S[mNames[m]] + ' ' + now.getFullYear() + '</option>';
    }
    adminContent.innerHTML =
        '<div class="month-selector">' +
            '<label>' + S.selectMonth + '</label>' +
            '<select id="dashboardMonthSelect">' + monthsHtml + '</select>' +
        '</div>' +
        '<div class="admin-stats">' +
            '<div class="stat-card stat-card--income"><h3>' + S.todaySales + '</h3><div class="stat-value" id="todaySales">0 IQD</div></div>' +
            '<div class="stat-card stat-card--expense"><h3>' + S.todayExpenses + '</h3><div class="stat-value" id="todayExpenses">0 IQD</div></div>' +
            '<div class="stat-card stat-card--net"><h3>' + S.netIncome + '</h3><div class="stat-value" id="todayNet">0 IQD</div></div>' +
            '<div class="stat-card"><h3>' + S.todayOrders + '</h3><div class="stat-value" id="todayOrders">0</div></div>' +
        '</div>' +
        '<div class="admin-stats" style="margin-top:16px;">' +
            '<div class="stat-card stat-card--income"><h3>' + S.monthlySales + '</h3><div class="stat-value" id="monthlySales">0 IQD</div></div>' +
            '<div class="stat-card stat-card--expense"><h3>' + S.monthlyExpenses + '</h3><div class="stat-value" id="monthlyExpenses">0 IQD</div></div>' +
            '<div class="stat-card stat-card--net"><h3>' + S.netIncome + '</h3><div class="stat-value" id="monthlyNet">0 IQD</div></div>' +
            '<div class="stat-card"><h3>' + S.bestSelling + '</h3><div class="stat-value" id="bestSelling">-</div></div>' +
        '</div>' +
        '<div class="card">' +
            '<h2>' + S.dailySales + ' — <span id="dailySalesMonthLabel"></span></h2>' +
            '<div id="dailySalesContainer"></div>' +
        '</div>' +
        '<div class="card" style="margin-top:20px;">' +
            '<h2>' + S.recentSales + '</h2>' +
            '<div id="recentSalesContainer"></div>' +
        '</div>';
    var monthSelect = document.getElementById('dashboardMonthSelect');
    if (monthSelect) {
        monthSelect.addEventListener('change', function () {
            renderDashboardUI(parseInt(this.value, 10));
        });
    }
    renderDashboardUI(currentMonth);
    renderRecentSalesUI();
    startAdminLiveListeners();
    syncAdminFinancialsFromServer(function () {
        renderDashboardUI(currentMonth);
        renderRecentSalesUI();
    });
}

function renderDashboardUI(month) {
    if (month === undefined || month === null) month = new Date().getMonth();
    var year = new Date().getFullYear();
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var mStart = new Date(year, month, 1);
    var mEnd = new Date(year, month + 1, 1);
    var startMs = mStart.getTime();
    var endMs = mEnd.getTime();
    var todayMs = today.getTime();
    var tomorrowMs = tomorrow.getTime();

    var sales = readCachedSales();
    var expenses = readCachedExpenses();
    var lang = localStorage.getItem('selectedLang') || 'ku';

    var todaySalesTotal = 0;
    var todayOrderCount = 0;
    var monthlyTotal = 0;
    var monthExpTotal = 0;
    var todayExpTotal = 0;
    var dayTotals = {};
    var itemCounts = {};

    sales.forEach(function (s) {
        var ms = saleTimestampToMs(s);
        if (ms >= todayMs && ms < tomorrowMs) {
            todaySalesTotal += s.total || 0;
            todayOrderCount++;
        }
        if (ms >= startMs && ms < endMs) {
            monthlyTotal += s.total || 0;
            var dayKey = new Date(ms).getDate();
            dayTotals[dayKey] = (dayTotals[dayKey] || 0) + (s.total || 0);
            if (s.items) {
                s.items.forEach(function (it) {
                    var itemName = it.name || it['name_' + lang] || it.name_en || '—';
                    var qty = it.quantity || 1;
                    if (!itemCounts[itemName]) itemCounts[itemName] = 0;
                    itemCounts[itemName] += qty;
                });
            }
        }
    });

    expenses.forEach(function (e) {
        if (isExpenseOnLocalDay(e, today)) todayExpTotal += e.price || 0;
        if (isExpenseInMonth(e, month, year)) monthExpTotal += e.price || 0;
    });

    var labelEl = document.getElementById('dailySalesMonthLabel');
    if (labelEl) labelEl.textContent = getMonthName(month, S);

    var elToday = document.getElementById('todaySales');
    if (elToday) elToday.textContent = todaySalesTotal.toLocaleString() + ' IQD';
    var elOrders = document.getElementById('todayOrders');
    if (elOrders) elOrders.textContent = todayOrderCount.toString();
    var elTodayExp = document.getElementById('todayExpenses');
    if (elTodayExp) elTodayExp.textContent = todayExpTotal.toLocaleString() + ' IQD';
    var elTodayNet = document.getElementById('todayNet');
    if (elTodayNet) elTodayNet.textContent = (todaySalesTotal - todayExpTotal).toLocaleString() + ' IQD';
    var elM = document.getElementById('monthlySales');
    if (elM) elM.textContent = monthlyTotal.toLocaleString() + ' IQD';
    var elMExp = document.getElementById('monthlyExpenses');
    if (elMExp) elMExp.textContent = monthExpTotal.toLocaleString() + ' IQD';
    var elMNet = document.getElementById('monthlyNet');
    if (elMNet) elMNet.textContent = (monthlyTotal - monthExpTotal).toLocaleString() + ' IQD';

    var bestName = '-';
    var bestQty = 0;
    Object.keys(itemCounts).forEach(function (name) {
        if (itemCounts[name] > bestQty) { bestQty = itemCounts[name]; bestName = name; }
    });
    var elB = document.getElementById('bestSelling');
    if (elB) {
        if (bestQty > 0) {
            elB.innerHTML = '<span class="best-item-name">' + bestName + '</span> <span class="best-item-qty">(' + bestQty + ' ' + S.sold + ')</span>';
        } else {
            elB.textContent = '-';
        }
    }

    var daysInM = new Date(year, month + 1, 0).getDate();
    var html = '<table class="daily-sales-table"><thead><tr><th>Day</th><th>' + S.total + ' (IQD)</th></tr></thead><tbody>';
    for (var d = 1; d <= daysInM; d++) {
        var dTotal = dayTotals[d] || 0;
        var cls = dTotal > 0 ? 'day-sales' : 'day-sales zero';
        var isToday = (d === today.getDate() && month === today.getMonth());
        html += '<tr' + (isToday ? ' style="background:rgba(212,175,55,0.06);"' : '') + '><td>' + (isToday ? '<strong style="color:var(--gold);">' + d + ' ★</strong>' : d) + '</td><td class="' + cls + '">' + dTotal.toLocaleString() + ' IQD</td></tr>';
    }
    html += '</tbody></table>';
    var container = document.getElementById('dailySalesContainer');
    if (container) container.innerHTML = html;
}

function renderRecentSalesUI() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var container = document.getElementById('recentSalesContainer');
    if (!container) return;

    var rows = getSalesDataSource().slice().sort(function (a, b) {
        return saleTimestampToMs(b) - saleTimestampToMs(a);
    }).slice(0, 5);

    if (rows.length === 0) {
        container.innerHTML = '<p style="color:#888;padding:16px;">' + S.noSalesYet + '</p>';
        return;
    }
    renderRecentSalesTable(rows, S, container);
}

function paintDashboardFromCache(month) {
    renderDashboardUI(month);
}

function stopDashboardListeners() {
    dashboardUnsubscribes.forEach(function (unsub) {
        try { unsub(); } catch (e) { /* ignore */ }
    });
    dashboardUnsubscribes = [];
    _adminLiveListenersStarted = false;
    _adminSalesLive = null;
    _adminExpensesLive = null;
}

function startDashboardListeners(month) {
    startAdminLiveListeners();
    renderDashboardUI(month);
}

function loadDashboardStats(month) {
    renderDashboardUI(month);
}

function loadRecentSales() {
    renderRecentSalesUI();
}

function renderRecentSalesTable(sales, S, container) {
    var html = '<div class="table-responsive"><table class="admin-table"><thead><tr><th>' + S.time + '</th><th>' + S.items + '</th><th>' + S.total + ' (IQD)</th></tr></thead><tbody>';
    sales.forEach(function (sale) {
        var cnt = sale.items ? sale.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0) : 0;
        var tsMs = saleTimestampToMs(sale);
        var timeStr = tsMs ? toDisplayTime(new Date(tsMs)) : '—';
        html += '<tr><td>' + timeStr + '</td><td>' + cnt + S.itemsCount + '</td><td>' + (sale.total || 0) + ' IQD</td></tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

/* ============ MANAGE ITEMS ============ */

function readCachedCategories() {
    try {
        return JSON.parse(localStorage.getItem('cachedCategories') || '[]');
    } catch (e) {
        return [];
    }
}

function upsertCachedCategory(id, data) {
    if (!id) return;
    var cats = readCachedCategories();
    var idx = -1;
    for (var i = 0; i < cats.length; i++) {
        if (cats[i].id === id) { idx = i; break; }
    }
    var entry = { id: id, data: data };
    if (idx >= 0) cats[idx] = entry;
    else cats.push(entry);
    safeSetItem('cachedCategories', JSON.stringify(cats));
}

function refreshCategoriesCache(callback) {
    if (!MenuData.getCategories().length) {
        MenuData.loadCategories(5000, function (categories) {
            safeSetItem('cachedCategories', JSON.stringify(categories));
            if (callback) callback(categories);
        }, function () {
            if (callback) callback(readCachedCategories());
        });
        return;
    }
    safeSetItem('cachedCategories', JSON.stringify(MenuData.getCategories()));
    if (callback) callback(MenuData.getCategories());
}

function normalizeCategoryId(id) {
    return id ? String(id).toLowerCase().trim() : id;
}

function safeCategoryPreferredIndex(cat) {
    try {
        if (typeof categoryPreferredIndex === 'function') return categoryPreferredIndex(cat);
    } catch (e) {}
    return -1;
}

function buildCategoryMapFromCache() {
    var catMap = {};
    readCachedCategories().forEach(function (c) {
        if (c && c.id) catMap[normalizeCategoryId(c.id)] = c.data || {};
    });
    return catMap;
}

function getCategoryLabel(categoryId, lang, catMap) {
    if (!categoryId) return '-';
    lang = lang || localStorage.getItem('selectedLang') || 'ku';
    var lowerId = normalizeCategoryId(categoryId);
    var data = (catMap && (catMap[categoryId] || catMap[lowerId])) || null;
    if (!data) {
        readCachedCategories().some(function (c) {
            if (c.id && normalizeCategoryId(c.id) === lowerId) { data = c.data; return true; }
            return false;
        });
    }
    if (data) {
        return data['name_' + lang] || data.name_en || data.name_ku || data.name_ar || categoryId;
    }
    if (typeof getCategoryDisplayName === 'function') {
        var resolved = getCategoryDisplayName(categoryId, lang);
        if (resolved && resolved !== categoryId) return resolved;
    }
    return categoryId;
}

function loadManageItems() {
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;
    itemsActiveCategory = 'all';
    var adminContent = document.getElementById('adminContent');
    adminContent.innerHTML =
        '<div class="card">' +
            '<h2>' + S.manageItems + '</h2>' +
            '<button class="btn-primary" id="addItemBtn" style="margin-bottom:16px;">' + S.addNewItem + '</button>' +
            '<div class="form-group"><input type="text" id="itemSearch" placeholder="' + S.searchItems + '"></div>' +
            '<div class="admin-menu-category-bar">' +
                '<div class="admin-category-scroll" id="itemsCategoryScroll"></div>' +
            '</div>' +
            '<input type="hidden" id="categoryFilter" value="all">' +
            '<div id="itemsList"><div class="loading">Loading...</div></div>' +
        '</div>' +
        '<div id="itemModal" class="modal-overlay">' +
            '<div class="modal">' +
                '<div class="modal-content">' +
                    '<button class="modal-close" id="modalClose" aria-label="Close">' +
                        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                    '</button>' +
                    '<h2 id="modalTitle">' + S.addNewItem + '</h2>' +
                    '<form id="itemForm" novalidate>' +
                        '<div class="form-group"><label>' + S.kurdishName + '</label><input type="text" id="itemNameKu" autocomplete="off"></div>' +
                        '<div class="form-group"><label>' + S.arabicName + '</label><input type="text" id="itemNameAr" autocomplete="off"></div>' +
                        '<div class="form-group"><label>' + S.englishName + '</label><input type="text" id="itemNameEn" autocomplete="off"></div>' +
                        '<div class="form-group"><label>' + S.kurdishDesc + '</label><textarea id="itemDescKu" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.arabicDesc + '</label><textarea id="itemDescAr" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.englishDesc + '</label><textarea id="itemDescEn" rows="2"></textarea></div>' +
                        '<div class="form-group"><label>' + S.imageURL + '</label>' +
                            '<input type="file" accept="image/*" id="itemImageFile" style="margin-bottom:6px;">' +
                            '<input type="text" id="itemImageURL" placeholder="' + (S.imageUrlOrUpload || 'Paste image URL or upload above') + '">' +
                            '<img id="itemImagePreview" class="admin-img-preview" style="display:none;margin-top:8px;max-height:120px;max-width:100%;width:auto;height:auto;border-radius:8px;object-fit:contain;"></div>' +
                        '<div class="form-group"><label>' + S.price + '</label><input type="text" inputmode="decimal" id="itemPrice" autocomplete="off"></div>' +
                        '<div class="form-group admin-sizes-box">' +
                            '<div class="admin-sizes-header">' +
                                '<label class="admin-sizes-label">' +
                                    '<span class="admin-sizes-icon">🥤</span>' +
                                    '<span>' + (lang === 'ku' ? 'قەبارە و نرخەکان (وەک خواردنەوەکان)' : (lang === 'ar' ? 'الأحجام والأسعار (مثل المشروبات)' : 'Sizes & Prices (e.g. Drinks)')) + '</span>' +
                                '</label>' +
                                '<div class="admin-sizes-btn-group">' +
                                    '<button type="button" class="btn-secondary btn-sm" id="btnPresetDrinkSizes" title="Add Small, Medium, Big">' +
                                        '⚡ ' + (lang === 'ku' ? 'بچووک / ناوەند / گەورە' : (lang === 'ar' ? 'صغير / متوسط / كبير' : 'Small / Medium / Big')) +
                                    '</button>' +
                                    '<button type="button" class="btn-primary btn-sm" id="btnAddSizeRow">' +
                                        '+ ' + (lang === 'ku' ? 'قەبارە' : (lang === 'ar' ? 'حجم' : 'Add Size')) +
                                    '</button>' +
                                '</div>' +
                            '</div>' +
                            '<div id="itemSizesList" class="item-sizes-list"></div>' +
                            '<small class="admin-sizes-hint">' +
                                (lang === 'ku'
                                    ? 'بۆ خواردنەوە یان خواردن: دەتوانیت چەند قەبارەیەک دیاری بکەیت (بچووک، ناوەند، گەورە) لەگەڵ نرخی هەر قەبارەیەک.'
                                    : (lang === 'ar'
                                        ? 'للمشروبات أو الأطعمة: يمكنك تحديد أحجام متعددة (صغير، متوسط، كبير) مع سعر كل حجم.'
                                        : 'For drinks or food: Add multiple sizes (Small, Medium, Big) with individual prices.')) +
                            '</small>' +
                        '</div>' +
                         '<div class="form-group"><label>' + S.category + '</label>' +
                             '<div class="admin-inline-field">' +
                                 '<select id="itemCategory">' +
                                     '<option value="">' + S.select + '</option>' +
                                 '</select>' +
                                 '<button type="button" class="btn-primary" id="addNewCategoryBtn" aria-label="Add category">+</button>' +
                             '</div></div>' +
                          '<div class="form-group"><label>' + (S.group || 'Group') + '</label>' +
                              '<input type="text" id="itemGroupKu" placeholder="' + (S.kurdishName || 'Kurdish') + '">' +
                              '<input type="text" id="itemGroupAr" placeholder="' + (S.arabicName || 'Arabic') + '" style="margin-top:6px;">' +
                              '<input type="text" id="itemGroupEn" placeholder="' + (S.englishName || 'English') + '" style="margin-top:6px;">' +
                          '</div>' +
                        '<div class="form-group"><label><input type="checkbox" id="itemAvailable" checked> ' + S.available + '</label></div>' +
                        '<div class="modal-actions">' +
                        '<button type="button" class="btn-primary" id="saveItemBtn">' + S.saveItem + '</button>' +
                        '<button type="button" class="btn-secondary" id="cancelItemBtn">' + S.cancel + '</button>' +
                        '</div>' +
                        '<input type="hidden" id="itemId" value="">' +
                    '</form>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div id="quickCategoryModal" class="modal-overlay">' +
            '<div class="modal">' +
                '<div class="modal-content">' +
                    '<button class="modal-close" id="quickCategoryModalClose" aria-label="Close">' +
                        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                    '</button>' +
                    '<h2>' + S.createNewCategory + '</h2>' +
                    '<form id="quickCategoryForm">' +
                        '<div class="form-group"><label>' + S.categoryNameKu + '</label><input type="text" id="quickCategoryNameKu" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameAr + '</label><input type="text" id="quickCategoryNameAr" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameEn + '</label><input type="text" id="quickCategoryNameEn" required></div>' +
                        '<div class="form-group"><label>' + S.categoryImage + '</label><input type="url" id="quickCategoryImageURL" placeholder="https://..."></div>' +
                        '<div class="modal-actions">' +
                        '<button type="submit" class="btn-primary">' + S.saveCategory + '</button>' +
                        '<button type="button" class="btn-secondary" id="cancelQuickCategoryBtn">' + S.cancel + '</button>' +
                        '</div>' +
                    '</form>' +
                '</div>' +
            '</div>' +
        '</div>';
    loadCategoriesDropdown();
    loadCategoryFilter();
    refreshCategoriesCache();
    wireItemEvents();
    
    // Show loading state
    var itemsListEl = document.getElementById('itemsList');
    if (itemsListEl) {
        itemsListEl.innerHTML = '<div class="loading" style="text-align:center;padding:20px;color:var(--text-muted);">Loading items...</div>';
    }
    
    // Try to load from cache first for immediate display
    var hasCachedData = hydrateItemsUiFromCache();
    if (hasCachedData) {
        console.log('[admin items] Loaded from cache');
    }

    // Longer timeouts on phones/tablets (incl. iPad) where Firestore WebChannel is slower.
    var isMobile = window.innerWidth <= 1024 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var itemsTimeout = isMobile ? 6000 : 3000;
    var safetyTimeout = isMobile ? 8000 : 5000;

    var loadTimer = setTimeout(function () {
        if (MenuData.getItems().length === 0) {
            var el = document.getElementById('itemsList');
            if (el) {
                if (!hydrateItemsUiFromCache()) {
                    console.log('[admin items] Trying REST API fallback');
                    fetchMenuItemsForAdmin(12000).then(function (items) {
                        if (items && items.length > 0) {
                            _itemsSnapDocs = items.map(function (d) {
                                return { id: d.id, data: function () { return d; } };
                            });
                            renderItemsList(_itemsSnapDocs);
                            loadCategoryFilter();
                        } else if (el.querySelector('.loading')) {
                            el.innerHTML = '<p style="color:var(--text-muted);">' + (S.menuConnectionHint || 'Check your connection and try again.') + '</p>';
                        }
                    }).catch(function () {
                        if (el.querySelector('.loading')) {
                            el.innerHTML = '<p style="color:var(--text-muted);">' + (S.menuConnectionHint || 'Check your connection and try again.') + '</p>';
                        }
                    });
                }
            }
        }
    }, safetyTimeout);

    MenuData.loadItems(itemsTimeout, function (items) {
        clearTimeout(loadTimer);
        console.log('[admin items] Loaded from Firebase:', items.length, 'items');
        // Keep local cache in sync with Firebase (paper menu after seed).
        writeCachedMenuItemsFlat(items);
        var catNames = {};
        items.forEach(function (it) {
            if (it && it.category) catNames[it.category] = true;
        });
        try { localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(catNames))); } catch (e) {}

        _itemsSnapDocs = sortItemDocsForAdmin(items.map(function (d) {
            return { id: d.id, data: function () { return d; } };
        }));
        renderItemsList(_itemsSnapDocs);
        loadCategoryFilter();
        refreshCategoriesCache(function () {
            refreshCategoryFilterOptions();
            refreshItemCategoryDropdown();
        });
    }, function (err) {
        clearTimeout(loadTimer);
        console.error('[admin items] Error loading items:', err);
        // Always try to show cached data on error
        if (hydrateItemsUiFromCache()) {
            console.log('[admin items] Showing cached data after error');
            return;
        }
        console.log('[admin items] Trying REST API fallback after error');
        fetchMenuItemsForAdmin(12000).then(function (items) {
            if (items && items.length > 0) {
                _itemsSnapDocs = items.map(function (d) {
                    return { id: d.id, data: function () { return d; } };
                });
                renderItemsList(_itemsSnapDocs);
                loadCategoryFilter();
            } else {
                var el = document.getElementById('itemsList');
                if (el) el.innerHTML = '<p style="color:#C62828;">' + S.errorPrefix + err.message + '</p>';
            }
        }).catch(function () {
            var el = document.getElementById('itemsList');
            if (el) el.innerHTML = '<p style="color:#C62828;">' + S.errorPrefix + err.message + '</p>';
        });
    });
}

function stopItemsListener() {
    if (itemsUnsubscribe) {
        try { itemsUnsubscribe(); } catch (e) { /* ignore */ }
        itemsUnsubscribe = null;
    }
    _itemsSnapDocs = [];
}

function collectItemDocsFromSnap(snap) {
    var docs = [];
    snap.forEach(function (d) {
        var data = d.data();
        if (data.category && data.category.toLowerCase().trim() === 'water') return;
        docs.push(d);
    });
    return sortItemDocsForAdmin(docs);
}

function getCategoryOrderMap() {
    var map = {};
    readCachedCategories().forEach(function (c) {
        if (!c || !c.id) return;
        var o = c.data && c.data.order != null ? Number(c.data.order) : NaN;
        map[String(c.id).toLowerCase()] = isNaN(o) ? 9999 : o;
    });
    // Paper menu fallback order
    if (map['western-meals'] == null) map['western-meals'] = 1;
    if (map['western-sandwiches'] == null) map['western-sandwiches'] = 2;
    if (map['manaqeesh'] == null) map['manaqeesh'] = 3;
    if (map['appetizers'] == null) map['appetizers'] = 4;
    return map;
}

function sortItemDocsForAdmin(docs) {
    var catOrder = getCategoryOrderMap();
    return (docs || []).slice().sort(function (a, b) {
        var da = typeof a.data === 'function' ? a.data() : (a.data || a);
        var db_ = typeof b.data === 'function' ? b.data() : (b.data || b);
        var ca = String((da && da.category) || '').toLowerCase();
        var cb = String((db_ && db_.category) || '').toLowerCase();
        var ao = catOrder[ca] != null ? catOrder[ca] : 9999;
        var bo = catOrder[cb] != null ? catOrder[cb] : 9999;
        if (ao !== bo) return ao - bo;
        var ia = da && da.order != null ? Number(da.order) : 0;
        var ib = db_ && db_.order != null ? Number(db_.order) : 0;
        if (ia !== ib) return ia - ib;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

function filterItemDocs(docs, searchTerm, cat) {
    var filtered = docs.slice();
    if (searchTerm) {
        var lang = localStorage.getItem('selectedLang') || 'ku';
        var term = searchTerm.toLowerCase();
        filtered = filtered.filter(function (d) {
            var item = d.data();
            var name = (item['name_' + lang] || item.name_en || '').toLowerCase();
            return name.indexOf(term) !== -1;
        });
    }
    if (cat && cat !== 'all') {
        var catLower = cat.toLowerCase().trim();
        filtered = filtered.filter(function (d) {
            var dc = d.data().category;
            if (!dc) return false;
            var dcLower = String(dc).toLowerCase().trim();
            return dcLower === catLower || dcLower.indexOf(catLower) !== -1;
        });
    }
    return filtered;
}

function startItemsListener() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    backfillCreatedByForCurrentAdmin();
    if (!document.getElementById('itemsList')) return;

    if (itemsUnsubscribe) {
        try { itemsUnsubscribe(); } catch (e) { /* ignore */ }
        itemsUnsubscribe = null;
    }

    hydrateItemsUiFromCache();

    if (USE_LOCAL_API) {
        localApiRequest('menu_items.php').then(function(items) {
            var docs = items.map(function(item) {
                return {
                    id: item.id,
                    data: function() { return item; }
                };
            });
             _itemsSnapDocs = docs.filter(function(d) { return d.data().category && d.data().category.toLowerCase().trim() !== 'water'; });
            refreshCategoryFilterOptions();
            refreshItemCategoryDropdown();
            var searchEl = document.getElementById('itemSearch');
            var catEl = document.getElementById('categoryFilter');
            var searchTerm = searchEl ? searchEl.value : '';
            var cat = catEl ? catEl.value : itemsActiveCategory;
             renderItemsList(filterItemDocs(_itemsSnapDocs, searchTerm, cat));

            var cashierCache = [];
            var menuCache = [];
            _itemsSnapDocs.forEach(function(d) {
                var data = d.data();
                cashierCache.push({ id: d.id, v: data });
                menuCache.push(Object.assign({ id: d.id }, data));
            });
            safeSetItem('cachedCashierItems', JSON.stringify(cashierCache));
            writeCachedMenuItemsFlat(menuCache);

            var catNames = {};
            _itemsSnapDocs.forEach(function(d) {
                var c = d.data().category;
                if (c && c.toLowerCase().trim() !== 'water') catNames[c] = true;
            });
            localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(catNames)));
        }).catch(function(err) {
            console.warn('[admin items] Local API failed:', err.message);
            if (!hydrateItemsUiFromCache()) {
                clearAdminLoadingEl('itemsList', '<p style="color:#C62828;">' + S.errorPrefix + (S.menuConnectionHint || 'Check connection') + '</p>');
            }
        });
        return;
    }

    if (!window.db) {
        if (!_itemsSnapDocs.length) {
            clearAdminLoadingEl('itemsList', '<p>' + S.noItemsFound + '</p>');
        }
        return;
    }

    function applyItemsSnap(snap) {
        if (snap.empty) {
            if (hydrateItemsUiFromCache()) return;
            if (isFirestoreCacheEmptySnap(snap)) return;
            clearAdminLoadingEl('itemsList', '<p>' + S.noItemsFound + '</p>');
            return;
        }
        _itemsSnapDocs = collectItemDocsFromSnap(snap);
        refreshCategoryFilterOptions();
        refreshItemCategoryDropdown();
        var searchEl = document.getElementById('itemSearch');
        var catEl = document.getElementById('categoryFilter');
        var searchTerm = searchEl ? searchEl.value : '';
        var cat = catEl ? catEl.value : itemsActiveCategory;
        renderItemsList(filterItemDocs(_itemsSnapDocs, searchTerm, cat));

        var cashierCache = [];
        var menuCache = [];
        snap.forEach(function (d) {
            var data = d.data();
            cashierCache.push({ id: d.id, v: data });
            menuCache.push(Object.assign({ id: d.id }, data));
        });
        safeSetItem('cachedCashierItems', JSON.stringify(cashierCache));
        writeCachedMenuItemsFlat(menuCache);

        var catNames = {};
        _itemsSnapDocs.forEach(function (d) {
            var c = d.data().category;
            if (c && c !== 'Water') catNames[c] = true;
        });
        localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(catNames)));
    }

    adminGetWithTimeout(getDocs(collection(db, 'menuItems')), 8000).then(applyItemsSnap).catch(function (e) {
        console.warn('[admin items] get failed:', e.message);
        if (isFirestoreApiDisabledError(e)) {
            showFirestoreApiDisabledAlert();
        }
        if (!hydrateItemsUiFromCache()) {
            clearAdminLoadingEl('itemsList', '<p style="color:#C62828;">' + S.errorPrefix + (S.menuConnectionHint || 'Check connection') + '</p>');
        }
    });

    if (navigator.onLine) {
        fetchMenuItemsForAdmin(12000).then(function (items) {
            if (!items || !items.length) return;
            writeCachedMenuItemsFlat(items);
            hydrateItemsUiFromCache();
            loadCategoryFilter();
        }).catch(function (e) {
            console.warn('[admin items] REST fallback:', e.message || e);
        });
    }

    setTimeout(function () {
        if (!adminSectionStillLoading('itemsList')) return;
        if (hydrateItemsUiFromCache()) return;
        clearAdminLoadingEl('itemsList', '<p>' + S.noItemsFound + '</p>');
    }, 10000);

     itemsUnsubscribe = onSnapshot(collection(db, 'menuItems'), function (snap) {
        applyItemsSnap(snap);
    }, function (e) {
        console.error('Items listener error:', e);
        if (!hydrateItemsUiFromCache()) {
            clearAdminLoadingEl('itemsList', '<p style="color:#C62828;">' + S.errorPrefix + e.message + '</p>');
        }
    });
}

function loadItemsList() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     backfillCreatedByForCurrentAdmin();
     if (hydrateItemsUiFromCache()) {
         loadCategoryFilter();
         return;
     }
     var items = MenuData.getItems();
     if (items.length > 0) {
         _itemsSnapDocs = items.map(function (d) {
             return { id: d.id, data: function () { return d; } };
         });
         renderItemsList(_itemsSnapDocs);
         loadCategoryFilter();
         return;
     }
     if (!window.db) {
         var el = document.getElementById('itemsList');
         if (el && el.querySelector('.loading')) {
             el.innerHTML = '<p>' + S.noItemsFound + '</p>';
         }
         return;
     }
     // Still empty after auth — do not leave spinner forever.
     if (adminSectionStillLoading('itemsList')) {
         MenuData.loadItems(6000, function (fresh) {
             _itemsSnapDocs = fresh.map(function (d) {
                 return { id: d.id, data: function () { return d; } };
             });
             renderItemsList(_itemsSnapDocs);
             loadCategoryFilter();
         }, function () {
             fetchMenuItemsForAdmin(12000).then(function (restItems) {
                 if (restItems && restItems.length) {
                     _itemsSnapDocs = restItems.map(function (d) {
                         return { id: d.id, data: function () { return d; } };
                     });
                     renderItemsList(_itemsSnapDocs);
                     loadCategoryFilter();
                 } else if (!hydrateItemsUiFromCache()) {
                     clearAdminLoadingEl('itemsList', '<p>' + (S.menuConnectionHint || S.noItemsFound) + '</p>');
                 }
             }).catch(function () {
                 if (!hydrateItemsUiFromCache()) {
                     clearAdminLoadingEl('itemsList', '<p>' + (S.menuConnectionHint || S.noItemsFound) + '</p>');
                 }
             });
         });
     }
}

function loadCategoriesDropdown() {
    var select = document.getElementById('itemCategory');
    if (!select) return Promise.resolve();

    refreshItemCategoryDropdown();

    if (!window.db) return Promise.resolve();

    if (!MenuData.getCategories().length) {
        return new Promise(function (resolve) {
            MenuData.loadCategories(12000, function (categories) {
                safeSetItem('cachedCategories', JSON.stringify(categories));
                refreshItemCategoryDropdown();
                resolve();
            }, function () {
                resolve();
            });
        });
    }

    return Promise.resolve();
}

function loadCategoriesFromCache() {
    refreshItemCategoryDropdown();
}

function escapeHtmlAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

function escapeHtmlText(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getUniqueItemCategoryIds(docs) {
    var names = {};
    (docs || []).forEach(function (d) {
        var c = typeof d.data === 'function' ? d.data().category : (d.category || null);
        if (c && c.toLowerCase().trim() !== 'water') names[c] = true;
    });
    return Object.keys(names);
}

function getAllItemCategoryIdsForFilter() {
    var names = {};
    function addName(c) {
        if (c && normalizeCategoryId(c) !== 'water') names[normalizeCategoryId(c)] = true;
    }
    getUniqueItemCategoryIds(_itemsSnapDocs).forEach(addName);
    readCachedCategories().forEach(function (c) {
        if (c && c.id) addName(c.id);
    });
    try {
        JSON.parse(localStorage.getItem('cachedMenuItems') || '[]').forEach(function (it) {
            addName(it.category);
        });
    } catch (e) {}
    try {
        JSON.parse(localStorage.getItem('cachedCashierItems') || '[]').forEach(function (it) {
            addName(it.v && it.v.category);
        });
    } catch (e) {}
    try {
        JSON.parse(localStorage.getItem('cachedMenuCategoryNames') || '[]').forEach(addName);
    } catch (e) {}
    var sorted = Object.keys(names).sort();
    console.log('[admin items] Available categories for filter:', sorted);
    return sorted;
}

function buildCategorySelectOptions(categories, itemCategoryIds, lang, S, allOption) {
    var seen = {};
    var html = allOption ? '<option value="all">' + S.allCategories + '</option>' : '<option value="">' + S.select + '</option>';
    (categories || []).forEach(function (c) {
        if (!c || !c.id) return;
        var lower = String(c.id).toLowerCase();
        if (seen[lower]) return;
        seen[lower] = true;
        var cat = c.data || {};
        var name = cat['name_' + lang] || cat.name_en || cat.name_ku || cat.name_ar || c.id || S.unnamed;
        html += '<option value="' + escapeHtmlAttr(c.id) + '">' + escapeHtmlText(name) + '</option>';
    });
    (itemCategoryIds || []).forEach(function (id) {
        if (!id || seen[id]) return;
        seen[id] = true;
        var label = getCategoryLabel(id, lang, buildCategoryMapFromCache());
        html += '<option value="' + escapeHtmlAttr(id) + '">' + escapeHtmlText(label) + '</option>';
    });
    return html;
}

function adminAllCategoryIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/>' +
        '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>';
}

function getAdminCategoryIcon(catId, catMap) {
    var data = catMap && catMap[catId];
    if (data && data.image) {
        return '<img class="cat-icon" src="' + escapeHtmlAttr(data.image) + '" alt="" onerror="this.onerror=null;this.style.display=\'none\'">';
    }
    return '<svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>';
}

function closeItemsCatPicker() {
    var panel = document.getElementById('itemsCatPickerPanel');
    var btn = document.getElementById('itemsCatPickerBtn');
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openItemsCatPicker() {
    var panel = document.getElementById('itemsCatPickerPanel');
    var btn = document.getElementById('itemsCatPickerBtn');
    if (panel) panel.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
}

function updateItemsCatPickerLabel() {
    var labelEl = document.getElementById('itemsCatPickerLabel');
    if (!labelEl) return;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    if (itemsActiveCategory === 'all') {
        labelEl.textContent = S.allCategories;
        return;
    }
    labelEl.textContent = getCategoryLabel(itemsActiveCategory, lang, buildCategoryMapFromCache());
}

function selectItemsCategory(catId) {
    console.log('[admin items] selectItemsCategory called with:', catId);
    itemsActiveCategory = catId || 'all';
    var cf = document.getElementById('categoryFilter');
    if (cf) {
        cf.value = itemsActiveCategory;
        console.log('[admin items] Category filter set to:', cf.value);
    }
    renderItemsCategoryBar();
    var search = document.getElementById('itemSearch');
    var searchTerm = search ? search.value : '';
    console.log('[admin items] Applying filter with search:', searchTerm, 'category:', itemsActiveCategory);
    applyItemFilter(searchTerm, itemsActiveCategory);
}

function renderItemsCategoryBar() {
    var scroll = document.getElementById('itemsCategoryScroll');
    if (!scroll) return;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var catMap = buildCategoryMapFromCache();
    var cats = getAllItemCategoryIdsForFilter();
    var active = itemsActiveCategory || 'all';

    var html = '<button type="button" class="category-btn category-btn-all' + (active === 'all' ? ' active' : '') + '" data-cat="all">' +
        '<span class="cat-all-mark" aria-hidden="true">' + adminAllCategoryIconSvg() + '</span>' +
        '<span class="cat-label">' + escapeHtmlText(S.allCategories) + '</span></button>';

    cats.forEach(function (id) {
        var label = getCategoryLabel(id, lang, catMap);
        var icon = getAdminCategoryIcon(id, catMap);
        html += '<button type="button" class="category-btn' + (active === id ? ' active' : '') + '" data-cat="' + escapeHtmlAttr(id) + '">' +
            icon + '<span class="cat-label">' + escapeHtmlText(label) + '</span></button>';
    });

    if (!cats.length) {
        html += '<span class="items-cat-empty">' + escapeHtmlText(S.noCategories || 'No categories yet') + '</span>';
    }

    scroll.innerHTML = html;
    
    if (scroll._categoryClickHandler) {
        scroll.removeEventListener('click', scroll._categoryClickHandler);
        scroll.removeEventListener('pointerdown', scroll._categoryClickHandler);
    }
    
    // Use click so horizontal chip scroll still works on mobile
    function handleCategoryClick(e) {
        var catBtn = e.target.closest('.category-btn');
        if (catBtn) {
            var catId = catBtn.getAttribute('data-cat') || 'all';
            selectItemsCategory(catId);
        }
    }
    
    scroll._categoryClickHandler = handleCategoryClick;
    scroll.addEventListener('click', handleCategoryClick);
}

function refreshCategoryFilterOptions() {
    renderItemsCategoryBar();
}

function refreshItemCategoryDropdown() {
    var select = document.getElementById('itemCategory');
    if (!select) return;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var prev = select.value;
    select.innerHTML = buildCategorySelectOptions(
        readCachedCategories(),
        [],
        lang,
        S,
        false
    );
    for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === prev) {
            select.selectedIndex = i;
            break;
        }
    }
}

function loadCategoryFilter() {
    var cf = document.getElementById('categoryFilter');
    if (!cf) return;

    // Render category bar immediately from cache if available
    renderItemsCategoryBar();

    if (!window.db) {
        return;
    }

    if (!MenuData.getCategories().length) {
        MenuData.loadCategories(6000, function (categories) {
            safeSetItem('cachedCategories', JSON.stringify(categories));
            refreshCategoryFilterOptions();
        }, function (err) {
            console.error('Error loading category filter:', err);
            refreshCategoryFilterOptions();
        });
        return;
    }

    safeSetItem('cachedCategories', JSON.stringify(MenuData.getCategories()));
    refreshCategoryFilterOptions();
}

/* ========================================================
   ADMIN REORDERING (BUTTONS & LONG-TOUCH / DRAG) + TOASTS
   ======================================================== */
var _currentAdminItems = [];
var _currentAdminCategories = [];

function showAdminToast(msg) {
    var toast = document.getElementById('adminToastEl');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'adminToastEl';
        toast.className = 'admin-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function () {
        toast.classList.remove('show');
    }, 2400);
}

function updateRowOrderNumbers(tbodyEl) {
    if (!tbodyEl) return;
    var rows = tbodyEl.querySelectorAll('.admin-row');
    rows.forEach(function (r, idx) {
        var num = r.querySelector('.admin-order-num');
        if (num) num.textContent = String(idx + 1);
        var upBtn = r.querySelector('.move-item-up, .move-cat-up');
        if (upBtn) upBtn.disabled = (idx === 0);
        var downBtn = r.querySelector('.move-item-down, .move-cat-down');
        if (downBtn) downBtn.disabled = (idx === rows.length - 1);
    });
}

function enableTouchAndDragReorder(tbodyEl, onReorderEnd) {
    if (!tbodyEl) return;
    if (tbodyEl._dragCleanup) {
        tbodyEl._dragCleanup();
    }

    var draggedRow = null;
    var startY = 0;
    var startX = 0;
    var isDragging = false;
    var longPressTimer = null;
    var scrollInterval = null;

    function stopAutoScroll() {
        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }
    }

    function checkAutoScroll(clientY) {
        var edge = 80;
        var h = window.innerHeight;
        var step = 0;
        if (clientY < edge) {
            step = -Math.max(6, Math.round((edge - clientY) / 3));
        } else if (clientY > h - edge) {
            step = Math.max(6, Math.round((clientY - (h - edge)) / 3));
        }

        if (step !== 0) {
            if (!scrollInterval) {
                scrollInterval = setInterval(function () {
                    window.scrollBy(0, step);
                }, 20);
            }
        } else {
            stopAutoScroll();
        }
    }

    function startDrag(row) {
        if (!row || isDragging) return;
        isDragging = true;
        draggedRow = row;
        document.body.classList.add('admin-reordering-active');
        row.classList.add('is-dragging');
        if (navigator.vibrate) {
            try { navigator.vibrate(35); } catch (e) {}
        }
    }

    function moveDrag(clientX, clientY) {
        if (!isDragging || !draggedRow) return;
        checkAutoScroll(clientY);

        var rows = Array.prototype.slice.call(tbodyEl.children).filter(function (r) {
            return r !== draggedRow && r.classList.contains('admin-row');
        });

        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var rect = r.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                var mid = rect.top + rect.height / 2;
                if (clientY < mid) {
                    tbodyEl.insertBefore(draggedRow, r);
                } else {
                    tbodyEl.insertBefore(draggedRow, r.nextSibling);
                }
                updateRowOrderNumbers(tbodyEl);
                break;
            }
        }
    }

    function endDrag() {
        clearTimeout(longPressTimer);
        stopAutoScroll();
        if (isDragging && draggedRow) {
            draggedRow.classList.remove('is-dragging');
            document.body.classList.remove('admin-reordering-active');
            updateRowOrderNumbers(tbodyEl);
            var newIds = Array.prototype.slice.call(tbodyEl.querySelectorAll('.admin-row')).map(function (r) {
                return r.getAttribute('data-id');
            }).filter(Boolean);
            if (typeof onReorderEnd === 'function') {
                onReorderEnd(newIds);
            }
        }
        isDragging = false;
        draggedRow = null;
    }

    function onPointerDown(e) {
        if (e.target.closest('button, input, select, textarea, a, .btn-reorder')) return;
        var grip = e.target.closest('.admin-drag-grip');
        var row = e.target.closest('.admin-row');
        if (!row) return;

        startX = e.clientX;
        startY = e.clientY;

        if (grip) {
            e.preventDefault();
            startDrag(row);
        } else if (e.pointerType === 'touch') {
            longPressTimer = setTimeout(function () {
                startDrag(row);
            }, 230);
        }
    }

    function onPointerMove(e) {
        if (longPressTimer && !isDragging) {
            var dx = Math.abs(e.clientX - startX);
            var dy = Math.abs(e.clientY - startY);
            if (dx > 10 || dy > 10) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }

        if (isDragging) {
            e.preventDefault();
            moveDrag(e.clientX, e.clientY);
        }
    }

    function onPointerUp(e) {
        endDrag();
    }

    function onPointerCancel(e) {
        endDrag();
    }

    tbodyEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    tbodyEl._dragCleanup = function () {
        clearTimeout(longPressTimer);
        stopAutoScroll();
        tbodyEl.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
    };
}

/* ========================================================
   ITEM SIZES & PRICES BUILDER (SMALL, MEDIUM, BIG, ETC.)
   ======================================================== */
function createAdminSizeRow(data) {
    data = data || {};
    var row = document.createElement('div');
    row.className = 'item-size-row';
    var pVal = (data.price !== undefined && data.price !== null) ? data.price : '';

    row.innerHTML =
        '<div class="item-size-inputs">' +
            '<div class="item-size-field">' +
                '<span class="item-size-sublabel">Kurdish</span>' +
                '<input type="text" class="size-name-ku" placeholder="بچووک / گەورە" value="' + escapeHtmlAttr(data.name_ku || '') + '">' +
            '</div>' +
            '<div class="item-size-field">' +
                '<span class="item-size-sublabel">Arabic</span>' +
                '<input type="text" class="size-name-ar" placeholder="صغير / كبير" value="' + escapeHtmlAttr(data.name_ar || '') + '">' +
            '</div>' +
            '<div class="item-size-field">' +
                '<span class="item-size-sublabel">English</span>' +
                '<input type="text" class="size-name-en" placeholder="Small / Big" value="' + escapeHtmlAttr(data.name_en || '') + '">' +
            '</div>' +
            '<div class="item-size-field">' +
                '<span class="item-size-sublabel">Price (IQD)</span>' +
                '<input type="text" inputmode="decimal" class="size-price" placeholder="2500" value="' + escapeHtmlAttr(pVal !== '' ? String(pVal) : '') + '">' +
            '</div>' +
        '</div>' +
        '<button type="button" class="btn-remove-size" title="Remove" aria-label="Remove">✕</button>';

    var removeBtn = row.querySelector('.btn-remove-size');
    if (removeBtn) {
        removeBtn.addEventListener('click', function () {
            row.remove();
        });
    }

    var priceInp = row.querySelector('.size-price');
    if (priceInp) {
        priceInp.addEventListener('input', function () {
            var mainPrice = document.getElementById('itemPrice');
            if (mainPrice && (!mainPrice.value || mainPrice.value === '0')) {
                mainPrice.value = this.value;
            }
        });
    }

    return row;
}

function collectAdminItemSizes() {
    var list = document.getElementById('itemSizesList');
    if (!list) return [];
    var rows = list.querySelectorAll('.item-size-row');
    var sizes = [];
    rows.forEach(function (row) {
        var ku = (row.querySelector('.size-name-ku') || {}).value || '';
        var ar = (row.querySelector('.size-name-ar') || {}).value || '';
        var en = (row.querySelector('.size-name-en') || {}).value || '';
        var p = (row.querySelector('.size-price') || {}).value || '';
        ku = ku.trim(); ar = ar.trim(); en = en.trim(); p = p.trim().replace(',', '.');
        if (!ku && !ar && !en && !p) return;
        var pNum = parseFloat(p);
        sizes.push({
            name_ku: ku || ar || en || 'قەبارە',
            name_ar: ar || ku || en || 'حجم',
            name_en: en || ku || ar || 'Size',
            price: isNaN(pNum) ? 0 : pNum
        });
    });
    return sizes;
}

function populateAdminItemSizes(sizes) {
    var list = document.getElementById('itemSizesList');
    if (!list) return;
    list.innerHTML = '';
    if (Array.isArray(sizes) && sizes.length > 0) {
        sizes.forEach(function (sz) {
            list.appendChild(createAdminSizeRow(sz));
        });
    }
}

/* ========================================================
   REORDER CATEGORIES & ITEMS LOGIC
   ======================================================== */
function persistCategoryOrder(catList) {
    if (!catList || !catList.length) return;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var toastMsg = (lang === 'ku') ? 'ڕیزبەندی بەشەکان سەرکەوتووانە نوێکرایەوە' : ((lang === 'ar') ? 'تم تحديث ترتيب الفئات بنجاح' : 'Categories order updated successfully');

    catList.forEach(function (c, idx) {
        if (!c) return;
        c.data = c.data || {};
        c.data.order = idx;
    });

    _currentAdminCategories = catList;
    renderCategoriesTable(catList);
    showAdminToast(toastMsg);

    safeSetItem('cachedCategories', JSON.stringify(catList));
    if (typeof MenuData !== 'undefined' && MenuData.setCategories) {
        MenuData.setCategories(catList);
    }

    if (window.db && typeof writeBatch === 'function') {
        try {
            var batch = writeBatch(db);
            catList.forEach(function (c, idx) {
                if (!c || !c.id || c.virtual) return;
                var ref = doc(db, 'categories', String(c.id));
                batch.set(ref, { order: idx, updated_at: serverTimestamp() }, { merge: true });
            });
            batch.commit().then(function () {
                console.log('[categories] Order batch committed to Firestore');
            }).catch(function (err) {
                console.warn('[categories] Batch error:', err);
            });
        } catch (e) {
            console.warn('[categories] writeBatch exception:', e);
        }
    }
}

function moveCategoryByStep(catId, step) {
    if (!_currentAdminCategories || !_currentAdminCategories.length) return;
    var idx = -1;
    for (var i = 0; i < _currentAdminCategories.length; i++) {
        if (_currentAdminCategories[i] && String(_currentAdminCategories[i].id) === String(catId)) {
            idx = i;
            break;
        }
    }
    if (idx === -1) return;
    var targetIdx = idx + step;
    if (targetIdx < 0 || targetIdx >= _currentAdminCategories.length) return;
    var temp = _currentAdminCategories[idx];
    _currentAdminCategories[idx] = _currentAdminCategories[targetIdx];
    _currentAdminCategories[targetIdx] = temp;
    persistCategoryOrder(_currentAdminCategories);
}

function reorderCategoriesByIds(newIds) {
    if (!_currentAdminCategories || !_currentAdminCategories.length || !newIds) return;
    var map = {};
    _currentAdminCategories.forEach(function (c) { if (c && c.id) map[String(c.id)] = c; });
    var reordered = [];
    newIds.forEach(function (id) {
        if (map[String(id)]) {
            reordered.push(map[String(id)]);
            delete map[String(id)];
        }
    });
    Object.keys(map).forEach(function (id) { reordered.push(map[id]); });
    _currentAdminCategories = reordered;
    persistCategoryOrder(_currentAdminCategories);
}

function persistItemOrder(itemList) {
    if (!itemList || !itemList.length) return;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var toastMsg = (lang === 'ku') ? 'ڕیزبەندی ئایتمەکان سەرکەوتووانە نوێکرایەوە' : ((lang === 'ar') ? 'تم تحديث ترتيب المنتجات بنجاح' : 'Items order updated successfully');

    itemList.forEach(function (docObj, idx) {
        if (!docObj) return;
        if (typeof docObj.data === 'function') {
            var currentData = docObj.data() || {};
            currentData.order = idx;
            docObj.data = function () { return currentData; };
        } else if (docObj.data) {
            docObj.data.order = idx;
        } else {
            docObj.order = idx;
        }
    });

    var idToIdx = {};
    itemList.forEach(function (it, idx) { if (it && it.id) idToIdx[it.id] = idx; });
    _itemsSnapDocs.forEach(function (d) {
        if (d && d.id && idToIdx[d.id] !== undefined) {
            var dataObj = typeof d.data === 'function' ? d.data() : (d.data || d);
            dataObj.order = idToIdx[d.id];
            if (typeof d.data === 'function') {
                d.data = function () { return dataObj; };
            }
        }
    });

    renderItemsList(itemList);
    showAdminToast(toastMsg);

    var flat = _itemsSnapDocs.map(function (doc) {
        var data = typeof doc.data === 'function' ? doc.data() : (doc.data || doc);
        return Object.assign({ id: doc.id }, data);
    });
    writeCachedMenuItemsFlat(flat);
    if (typeof MenuData !== 'undefined' && MenuData.setItems) {
        MenuData.setItems(flat);
    }

    if (window.db && typeof writeBatch === 'function') {
        try {
            var batch = writeBatch(db);
            itemList.forEach(function (it, idx) {
                if (!it || !it.id) return;
                var ref = doc(db, 'menuItems', String(it.id));
                batch.set(ref, { order: idx, updated_at: serverTimestamp() }, { merge: true });
            });
            batch.commit().then(function () {
                console.log('[items] Order batch committed to Firestore');
            }).catch(function (err) {
                console.warn('[items] Batch error:', err);
            });
        } catch (e) {
            console.warn('[items] writeBatch exception:', e);
        }
    }
}

function moveItemByStep(itemId, step) {
    if (!_currentAdminItems || !_currentAdminItems.length) return;
    var idx = -1;
    for (var i = 0; i < _currentAdminItems.length; i++) {
        if (_currentAdminItems[i] && String(_currentAdminItems[i].id) === String(itemId)) {
            idx = i;
            break;
        }
    }
    if (idx === -1) return;
    var targetIdx = idx + step;
    if (targetIdx < 0 || targetIdx >= _currentAdminItems.length) return;
    var temp = _currentAdminItems[idx];
    _currentAdminItems[idx] = _currentAdminItems[targetIdx];
    _currentAdminItems[targetIdx] = temp;
    persistItemOrder(_currentAdminItems);
}

function reorderItemsByIds(newIds) {
    if (!_currentAdminItems || !_currentAdminItems.length || !newIds) return;
    var map = {};
    _currentAdminItems.forEach(function (it) { if (it && it.id) map[String(it.id)] = it; });
    var reordered = [];
    newIds.forEach(function (id) {
        if (map[String(id)]) {
            reordered.push(map[String(id)]);
            delete map[String(id)];
        }
    });
    Object.keys(map).forEach(function (id) { reordered.push(map[id]); });
    _currentAdminItems = reordered;
    persistItemOrder(_currentAdminItems);
}

function renderItemsList(items) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var list = document.getElementById('itemsList');
    if (!list) return;
    _currentAdminItems = items || [];
    if (items.length === 0) {
        list.innerHTML = '<p>' + S.noItemsFound + '</p>';
        return;
    }

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var sortColLabel = (lang === 'ku') ? 'ڕیزبەندی' : ((lang === 'ar') ? 'الترتيب' : 'Order');

    function paintRows(catMap) {
        var html = '<div class="table-responsive"><table class="admin-table admin-table--items"><thead><tr><th class="admin-th-sort">' + escapeHtmlText(sortColLabel) + '</th><th>Image</th><th>Name</th><th>' + S.category + '</th><th>' + (S.group || 'Group') + '</th><th>' + S.price + '</th><th>' + S.available + '</th><th>Actions</th></tr></thead><tbody>';
        items.forEach(function (doc, idx) {
            var item = doc.data();
            var name = item['name_' + lang] || item.name_ku || item.name_ar || item.name_en || S.unnamed;
            var img = item.image || 'https://placehold.co/50x50?text=No+Image';
            var avail = item.available ? '<span style="color:#2E7D32;">' + S.yes + '</span>' : '<span style="color:#C62828;">' + S.no + '</span>';
            var catName = getCategoryLabel(item.category, lang, catMap);
            var groupName = item.group_ku || item.group_ar || item.group_en || '';
            var hasSizes = item.sizes && Array.isArray(item.sizes) && item.sizes.length > 0;
            var priceDisplay = hasSizes
                ? '<span class="admin-sizes-badge">🥤 ' + item.sizes.length + ' ' + (lang === 'ku' ? 'قەبارە' : (lang === 'ar' ? 'أحجام' : 'sizes')) + '</span><br><small style="color:var(--text-muted);">' + (item.price || 0) + ' IQD</small>'
                : ((item.price || 0) + ' IQD');

            html += '<tr class="admin-row" data-id="' + escapeHtmlAttr(doc.id) + '">' +
                '<td class="admin-sort-col" data-label="' + escapeHtmlAttr(sortColLabel) + '">' +
                    '<div class="admin-sort-cell">' +
                        '<span class="admin-drag-grip" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>' +
                        '<span class="admin-order-num">' + (idx + 1) + '</span>' +
                        '<div class="admin-reorder-btns">' +
                            '<button type="button" class="btn-reorder move-item-up" data-id="' + escapeHtmlAttr(doc.id) + '" ' + (idx === 0 ? 'disabled' : '') + ' title="Move Up">▲</button>' +
                            '<button type="button" class="btn-reorder move-item-down" data-id="' + escapeHtmlAttr(doc.id) + '" ' + (idx === items.length - 1 ? 'disabled' : '') + ' title="Move Down">▼</button>' +
                        '</div>' +
                    '</div>' +
                '</td>' +
                '<td data-label="' + escapeHtmlAttr(S.image || 'Image') + '"><img src="' + img + '" alt="' + escapeHtmlAttr(name) + '" width="48" height="48"></td>' +
                '<td data-label="' + escapeHtmlAttr(S.name || 'Name') + '">' + escapeHtmlText(name) + '</td>' +
                '<td data-label="' + escapeHtmlAttr(S.category || 'Category') + '">' + escapeHtmlText(catName) + '</td>' +
                '<td data-label="' + escapeHtmlAttr(S.group || 'Group') + '">' + escapeHtmlText(groupName) + '</td>' +
                '<td data-label="' + escapeHtmlAttr(S.price || 'Price') + '">' + priceDisplay + '</td>' +
                '<td data-label="' + escapeHtmlAttr(S.available || 'Available') + '">' + avail + '</td>' +
                '<td data-label="' + escapeHtmlAttr(S.actions || 'Actions') + '" class="admin-row-actions"><button type="button" class="btn-primary btn-sm edit-item" data-id="' + doc.id + '">' + S.edit + '</button>' +
                '<button type="button" class="btn-danger btn-sm delete-item" data-id="' + doc.id + '">' + S.delete + '</button></td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
        list.innerHTML = html;

        var tbodyEl = list.querySelector('tbody');
        if (tbodyEl) {
            enableTouchAndDragReorder(tbodyEl, function (newIds) {
                reorderItemsByIds(newIds);
            });
        }

        function handleButtonClick(e) {
            var upBtn = e.target.closest('.move-item-up');
            if (upBtn) {
                e.preventDefault();
                e.stopPropagation();
                moveItemByStep(upBtn.getAttribute('data-id'), -1);
                return;
            }
            var downBtn = e.target.closest('.move-item-down');
            if (downBtn) {
                e.preventDefault();
                e.stopPropagation();
                moveItemByStep(downBtn.getAttribute('data-id'), 1);
                return;
            }
            var editBtn = e.target.closest('.edit-item');
            if (editBtn) {
                e.preventDefault();
                e.stopPropagation();
                var itemId = editBtn.getAttribute('data-id');
                if (typeof editItem === 'function') editItem(itemId);
                return;
            }
            var deleteBtn = e.target.closest('.delete-item');
            if (deleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                var delId = deleteBtn.getAttribute('data-id');
                if (typeof deleteItem === 'function') deleteItem(delId);
            }
        }

        if (list._buttonClickHandler) {
            list.removeEventListener('click', list._buttonClickHandler);
            list.removeEventListener('pointerdown', list._buttonClickHandler);
        }
        list._buttonClickHandler = handleButtonClick;
        list.addEventListener('click', handleButtonClick);
    }

    // Paint immediately — do not wait for categories fetch (was causing infinite Loading...).
    paintRows(buildCategoryMapFromCache());

    if (!window.db) return;

    if (MenuData.getCategories().length > 0) {
        var catMap = {};
        MenuData.getCategories().forEach(function (c) {
            catMap[normalizeCategoryId(c.id)] = c.data;
        });
        paintRows(catMap);
    } else {
        MenuData.loadCategories(5000, function (categories) {
            var catMap = {};
            categories.forEach(function (c) {
                catMap[normalizeCategoryId(c.id)] = c.data;
            });
            safeSetItem('cachedCategories', JSON.stringify(categories));
            paintRows(catMap);
        }, function () {
            paintRows(buildCategoryMapFromCache());
        });
    }
}

function wireItemEvents() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var addBtn = document.getElementById('addItemBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            document.getElementById('modalTitle').textContent = S.addNewItem;
            document.getElementById('itemForm').reset();
            document.getElementById('itemId').value = '';
            populateAdminItemSizes([]);
            document.getElementById('itemAvailable').checked = true;
            var pr = document.getElementById('itemImagePreview');
            if (pr) pr.style.display = 'none';
            var saveBtn = document.getElementById('saveItemBtn');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = S.saveItem;
            }
            var modal = document.getElementById('itemModal');
            openAdminModal(modal);
            activeItemModal = modal;
            loadCategoriesDropdown();
        });
    }

    var closeBtn = document.getElementById('modalClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            closeAdminModal(document.getElementById('itemModal'));
            activeItemModal = null;
        });
    }

    var cancelBtn = document.getElementById('cancelItemBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            closeAdminModal(document.getElementById('itemModal'));
            activeItemModal = null;
        });
    }

    var form = document.getElementById('itemForm');
    function triggerSaveItem() {
        try {
            saveItem();
        } catch (err) {
            console.error('saveItem error:', err);
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
    }
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            triggerSaveItem();
        });
    }
    var saveItemBtn = document.getElementById('saveItemBtn');
    if (saveItemBtn) {
        saveItemBtn.addEventListener('click', function (e) {
            e.preventDefault();
            triggerSaveItem();
        });
    }

    var imgInput = document.getElementById('itemImageURL');
    if (imgInput) {
        imgInput.addEventListener('input', function () {
            var pr = document.getElementById('itemImagePreview');
            if (!pr) return;
            var url = this.value.trim();
            if (url) { pr.src = url; pr.style.display = 'block'; }
            else { pr.style.display = 'none'; }
        });
    }
    wireImageFileInput('itemImageFile', 'itemImageURL', 'itemImagePreview');

    var search = document.getElementById('itemSearch');
    if (search) {
        search.addEventListener('input', function () {
            applyItemFilter(search.value, itemsActiveCategory);
        });
    }

    // Quick category modal events
    var addNewCatBtn = document.getElementById('addNewCategoryBtn');
    if (addNewCatBtn) {
        addNewCatBtn.addEventListener('click', function () {
            document.getElementById('quickCategoryForm').reset();
            openAdminModal(document.getElementById('quickCategoryModal'));
        });
    }

    var quickCloseBtn = document.getElementById('quickCategoryModalClose');
    if (quickCloseBtn) {
        quickCloseBtn.addEventListener('click', function () {
            closeAdminModal(document.getElementById('quickCategoryModal'));
        });
    }

    var quickCancelBtn = document.getElementById('cancelQuickCategoryBtn');
    if (quickCancelBtn) {
        quickCancelBtn.addEventListener('click', function () {
            closeAdminModal(document.getElementById('quickCategoryModal'));
        });
    }

    var quickForm = document.getElementById('quickCategoryForm');
    if (quickForm) {
        quickForm.addEventListener('submit', function (e) {
            e.preventDefault();
            saveQuickCategory();
        });
    }

    var btnAddSize = document.getElementById('btnAddSizeRow');
    if (btnAddSize) {
        btnAddSize.addEventListener('click', function () {
            var list = document.getElementById('itemSizesList');
            if (list) {
                list.appendChild(createAdminSizeRow({ name_ku: '', name_ar: '', name_en: '', price: '' }));
                var lastRow = list.lastElementChild;
                if (lastRow) {
                    var inp = lastRow.querySelector('.size-name-ku');
                    if (inp) inp.focus();
                }
            }
        });
    }

    var btnPresetSizes = document.getElementById('btnPresetDrinkSizes');
    if (btnPresetSizes) {
        btnPresetSizes.addEventListener('click', function () {
            var list = document.getElementById('itemSizesList');
            if (list) {
                var baseP = parseFloat((document.getElementById('itemPrice') || {}).value || 0);
                var presets = [
                    { name_ku: 'بچووک', name_ar: 'صغير', name_en: 'Small', price: baseP > 0 ? baseP : '' },
                    { name_ku: 'ناوەند', name_ar: 'متوسط', name_en: 'Medium', price: baseP > 0 ? baseP + 500 : '' },
                    { name_ku: 'گەورە', name_ar: 'كبير', name_en: 'Big', price: baseP > 0 ? baseP + 1000 : '' }
                ];
                list.innerHTML = '';
                presets.forEach(function (sz) {
                    list.appendChild(createAdminSizeRow(sz));
                });
            }
        });
    }
}

function applyItemFilter(searchTerm, cat) {
    cat = cat || itemsActiveCategory || 'all';
    console.log('[admin items] applyItemFilter - searchTerm:', searchTerm, 'cat:', cat, 'itemsActiveCategory:', itemsActiveCategory);
    var items = MenuData.getItems();
    console.log('[admin items] Total items from MenuData:', items.length);
    if (items.length > 0) {
        _itemsSnapDocs = items.map(function (d) {
            return { id: d.id, data: function () { return d; } };
        });
        var filtered = filterItemDocs(_itemsSnapDocs, searchTerm, cat);
        console.log('[admin items] Filtered items count:', filtered.length);
        renderItemsList(filtered);
        return;
    }
    console.log('[admin items] No items available, showing empty list');
    renderItemsList([]);
}

/* Offline-resilient write helper.
   Firestore writes are applied to the local cache instantly and synced to the
   server once a connection is available. The promise from add/update/delete/
   commit only resolves AFTER the server confirms — which never happens while
   offline. So we run the success UI immediately (the data is already saved
   locally) and just log any real sync failure. This keeps the entire dashboard
   usable with no internet. */
var MENU_SYNC_WRITE = { requireSync: true };

function applyWrite(promise, onDone, onError, options) {
    options = options || {};
    var waitForCloud = options.requireSync === true && navigator.onLine;

    function callDone(isOfflineSave) {
        try {
            if (typeof onDone === 'function') onDone(!!isOfflineSave);
        } catch (e) {
            console.error('UI update error after write:', e);
        }
    }

    if (!promise || typeof promise.then !== 'function') {
        callDone(!navigator.onLine);
        return;
    }

    if (waitForCloud) {
        promise.then(function () {
            callDone(false);
        }).catch(function (err) {
            console.error('Firestore sync error:', err);
            if (typeof onError === 'function') onError(err);
        });
        return;
    }

    callDone(!navigator.onLine);
    promise.catch(function (err) {
        console.error('Firestore sync error (will retry when online):', err);
        if (typeof onError === 'function') onError(err);
    });
}

/* Convert a chosen image file into a small base64 data URL so it is stored
   directly inside the document — no upload server, no image hosting, and no
   internet required. It shows even when fully offline. The image is resized to
   max 500px and JPEG-compressed to stay well under Firestore's ~1MB limit. */
function fileToCompressedDataURL(file, maxDim, quality) {
    maxDim = maxDim || 500;
    quality = quality || 0.7;
    return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type)) { reject(new Error('Please choose an image file')); return; }
        // Keep transparency for non-JPEG sources (PNG/WebP/GIF/SVG icons) by
        // exporting PNG — JPEG has no alpha and would turn transparent areas
        // into an ugly black background. Photos (JPEG) stay JPEG to keep size down.
        var keepAlpha = file.type !== 'image/jpeg' && file.type !== 'image/jpg';
        var reader = new FileReader();
        reader.onload = function () {
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height;
                if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
                else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
                var canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                try {
                    resolve(keepAlpha
                        ? canvas.toDataURL('image/png')
                        : canvas.toDataURL('image/jpeg', quality));
                } catch (e) { reject(e); }
            };
            img.onerror = function () { reject(new Error('Could not load that image')); };
            img.src = reader.result;
        };
        reader.onerror = function () { reject(new Error('Could not read that file')); };
        reader.readAsDataURL(file);
    });
}

/* Picking a file fills the given (hidden/url) input with the compressed data
   URL and updates the preview image. */
function wireImageFileInput(fileInputId, targetInputId, previewId) {
    var fileInput = document.getElementById(fileInputId);
    if (!fileInput) return;
    fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        fileToCompressedDataURL(file).then(function (dataUrl) {
            var target = document.getElementById(targetInputId);
            if (target) target.value = dataUrl;
            var preview = document.getElementById(previewId);
            if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
        }).catch(function (e) {
            alert((e && e.message) || 'Image error');
        });
    });
}

function nextCategoryOrder() {
    var max = -1;
    readCachedCategories().forEach(function (c) {
        var o = c && c.data ? Number(c.data.order) : NaN;
        if (!isNaN(o) && o > max) max = o;
    });
    return max + 1;
}

function sanitizeCategoryDocId(nameEn, nameKu, nameAr) {
    var base = String(nameEn || nameKu || nameAr || 'category').trim();
    base = base.replace(/[\/\\#?[\]]/g, '-').replace(/\s+/g, ' ').trim();
    if (!base) base = 'category-' + Date.now();
    return base.slice(0, 80);
}

function saveQuickCategory() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var nameKu = document.getElementById('quickCategoryNameKu').value.trim();
    var nameAr = document.getElementById('quickCategoryNameAr').value.trim();
    var nameEn = document.getElementById('quickCategoryNameEn').value.trim();

    if (!nameKu || !nameAr || !nameEn) {
        alert(S.fillAll);
        return;
    }

    if (!window.db) {
        alert(S.itemSyncFailed + '\nFirebase not ready.');
        return;
    }
    if (!isAdminAuthenticated()) {
        alert(S.itemSyncFailed + '\nPlease log in again.');
        window.location.href = 'login.html';
        return;
    }

    var imgUrl = document.getElementById('quickCategoryImageURL').value.trim();
    var placeholderImg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%23e0e0e0 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23999%27%3ENo+Image%3C/text%3E%3C/svg%3E';
    var finalImg = imgUrl || placeholderImg;

    var now = new Date().toISOString();
    var plainData = {
        name_ku: nameKu,
        name_ar: nameAr,
        name_en: nameEn,
        image: finalImg,
        order: nextCategoryOrder(),
        created_at: now,
        updated_at: now
    };

    var categoryId = sanitizeCategoryDocId(nameEn, nameKu, nameAr);
    var newCatRef = doc(db, 'categories', categoryId);
    applyMenuCloudWrite({
        collection: 'categories',
        docId: newCatRef.id,
        isCreate: true,
        sdkPromise: setDoc(newCatRef, Object.assign({}, plainData, {
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        })),
        plainData: plainData,
        onDone: function (offline) {
            upsertCachedCategory(newCatRef.id, plainData);
            closeAdminModal(document.getElementById('quickCategoryModal'));
            loadCategoriesDropdown();
            renderCategoriesListNow();
            var select = document.getElementById('itemCategory');
            if (select) { select.value = newCatRef.id; }
            alert(offline ? S.categorySavedOffline : S.categorySavedCloud);
        },
        onError: function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
    });
}

function saveItem() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

     if (!window.db) {
         alert(S.itemSyncFailed + '\nFirebase not ready.');
         return;
     }

     var nameKuEl = document.getElementById('itemNameKu');
     var nameArEl = document.getElementById('itemNameAr');
     var nameEnEl = document.getElementById('itemNameEn');
     var priceEl = document.getElementById('itemPrice');
     var categoryEl = document.getElementById('itemCategory');
     if (!nameKuEl || !nameArEl || !nameEnEl || !priceEl || !categoryEl) {
         alert(S.itemSyncFailed);
         return;
     }

     var nameKu = nameKuEl.value.trim();
    var nameAr = nameArEl.value.trim();
    var nameEn = nameEnEl.value.trim();
    var price = priceEl.value.trim().replace(',', '.');
    var category = categoryEl.value.trim();

    var itemSizes = collectAdminItemSizes();
    if ((!price || isNaN(parseFloat(price))) && itemSizes.length > 0 && itemSizes[0].price != null) {
        price = String(itemSizes[0].price);
        priceEl.value = price;
    }

    if (!nameKu || !nameAr || !nameEn || (!price && itemSizes.length === 0)) {
        alert(S.fillAll);
        return;
    }
    if (!category) {
        alert(S.selectCategory || (S.fillAll + ' (' + S.category + ')'));
        categoryEl.focus();
        return;
    }
    if (isNaN(parseFloat(price))) {
        alert(S.fillAll + ' (' + S.price + ')');
        priceEl.focus();
        return;
    }

    var saveBtn = document.getElementById('saveItemBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.dataset.prevText = saveBtn.textContent;
        saveBtn.textContent = '…';
    }

    var saveTimedOut = false;
    var readyTimer = setTimeout(function () {
        saveTimedOut = true;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + '\n' + (S.connectionSlow || 'Connection slow — try again.'));
    }, 12000);

    function runSaveWhenAuthed() {
     if (!isAdminAuthenticated()) {
         clearTimeout(readyTimer);
         if (saveBtn) {
             saveBtn.disabled = false;
             saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
         }
         alert(S.itemSyncFailed + '\nPlease log in again.');
         window.location.href = 'login.html';
         return;
     }

    var imgUrl = document.getElementById('itemImageURL').value.trim();
    var placeholderImg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%23e0e0e0 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23999%27%3ENo+Image%3C/text%3E%3C/svg%3E';
    var finalImg = imgUrl || placeholderImg;

    if (finalImg.length > 950000) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + '\nImage too large — paste a URL or use a smaller photo.');
        return;
    }

    var itemId = document.getElementById('itemId').value;
    var now = new Date().toISOString();
    var parsedPrice = parseFloat(price) || (itemSizes.length > 0 ? (itemSizes[0].price || 0) : 0);
      var plainData = {
          name_ku: nameKu, name_ar: nameAr, name_en: nameEn,
          description_ku: document.getElementById('itemDescKu').value.trim(),
          description_ar: document.getElementById('itemDescAr').value.trim(),
          description_en: document.getElementById('itemDescEn').value.trim(),
          price: parsedPrice,
          sizes: itemSizes,
          category: category,
          group_ku: (document.getElementById('itemGroupKu') || {}).value || '',
          group_ar: (document.getElementById('itemGroupAr') || {}).value || '',
          group_en: (document.getElementById('itemGroupEn') || {}).value || '',
          image: finalImg,
          available: document.getElementById('itemAvailable').checked,
          updated_at: now,
          createdBy: getCurrentAdminEmail() || ''
      };

    var ref;
    var promise;
    var docId;
    var isCreate = !itemId;
    if (itemId) {
        docId = itemId;
        ref = doc(db, 'menuItems', itemId);
        promise = updateDoc(ref, Object.assign({}, plainData, {
            updated_at: serverTimestamp()
        }));
    } else {
        ref = doc(collection(db, 'menuItems'));
        docId = ref.id;
        plainData.created_at = now;
        promise = setDoc(ref, Object.assign({}, plainData, {
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }));
    }

    function finishSave(offline) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        upsertCachedMenuItem(docId, plainData);
        closeAdminModal(document.getElementById('itemModal'));
        activeItemModal = null;
        hydrateItemsUiFromCache();
        alert(offline ? S.itemSavedOffline : S.itemSavedCloud);
    }

    function failSave(err) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
    }

    applyMenuCloudWrite({
        collection: 'menuItems',
        docId: docId,
        isCreate: isCreate,
        sdkPromise: promise,
        plainData: plainData,
        onDone: finishSave,
        onError: failSave
    });
    }

    whenAdminReady(function () {
        if (saveTimedOut) return;
        clearTimeout(readyTimer);
        runSaveWhenAuthed();
    }).catch(function (err) {
        clearTimeout(readyTimer);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = saveBtn.dataset.prevText || S.saveItem;
        }
        alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
    });
}

function editItem(itemId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

    function openEditModal(item) {
        document.getElementById('itemId').value = itemId;
        document.getElementById('itemNameKu').value = item.name_ku || '';
        document.getElementById('itemNameAr').value = item.name_ar || '';
        document.getElementById('itemNameEn').value = item.name_en || '';
        document.getElementById('itemDescKu').value = item.description_ku || '';
        document.getElementById('itemDescAr').value = item.description_ar || '';
        document.getElementById('itemDescEn').value = item.description_en || '';
        document.getElementById('itemPrice').value = item.price || '';
        document.getElementById('itemAvailable').checked = item.available !== false;
        var groupEl = document.getElementById('itemGroupKu');
        if (groupEl) groupEl.value = item.group_ku || '';
        groupEl = document.getElementById('itemGroupAr');
        if (groupEl) groupEl.value = item.group_ar || '';
        groupEl = document.getElementById('itemGroupEn');
        if (groupEl) groupEl.value = item.group_en || '';
        if (item.image) {
            document.getElementById('itemImageURL').value = item.image;
            var pr = document.getElementById('itemImagePreview');
            if (pr) { pr.src = item.image; pr.style.display = 'block'; }
        } else {
            var pr = document.getElementById('itemImagePreview');
            if (pr) { pr.style.display = 'none'; }
        }
        populateAdminItemSizes(item.sizes || []);
        document.getElementById('modalTitle').textContent = S.editItem;
        var saveBtn = document.getElementById('saveItemBtn');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = S.saveItem;
        }
        var modal = document.getElementById('itemModal');
        openAdminModal(modal);
        activeItemModal = modal;
        loadCategoriesDropdown().then(function () {
            document.getElementById('itemCategory').value = item.category || '';
        });
    }

    var cached = getMenuItemFromLocalCache(itemId);
    if (cached) openEditModal(cached);

    if (!window.db) {
        if (!cached) alert(S.noItemsFound);
        return;
    }

    getDoc(doc(db, 'menuItems', itemId)).then(function (docSnap) {
        if (!snapExists(docSnap)) {
            if (!cached) alert(S.noItemsFound);
            return;
        }
        openEditModal(docSnap.data());
    }).catch(function (e) {
        if (!cached) alert(S.errorPrefix + e.message);
    });
}

function deleteItem(itemId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!confirm(S.deleteConfirm)) return;
    if (!isAdminAuthenticated()) {
        alert(S.itemSyncFailed + '\nPlease log in again.');
        return;
    }
    applyMenuCloudWrite({
        collection: 'menuItems',
        docId: itemId,
        isDelete: true,
        sdkPromise: deleteDoc(doc(db, 'menuItems', itemId)),
        onDone: function () {
            removeCachedMenuItem(itemId);
            hydrateItemsUiFromCache();
        },
        onError: function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
    });
}

/* ============ CATEGORIES ============ */

function mergeCategoryLists(serverCats, cachedCats) {
    var result = [];
    var seen = {};
    var all = (serverCats && serverCats.length ? serverCats : []).concat(cachedCats || []);
    all.forEach(function (c) {
        if (!c || !c.id) return;
        var lower = normalizeCategoryId(c.id);
        if (seen[lower]) return;
        seen[lower] = true;
        result.push(c);
    });
    return result;
}

function renderCategoriesListNow() {
    var cats = readCachedCategories();
    var have = {};
    cats.forEach(function (c) { have[c.id] = true; });
    var merged = mergeMenuCategories(cats, have);
    renderCategoriesTable(merged);
    return merged.length > 0;
}

function loadManageCategories() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    adminContent.innerHTML =
        '<div class="card">' +
            '<h2>' + S.manageCategories + '</h2>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">' +
                '<button class="btn-primary" id="addCategoryBtn">' + S.addCategory + '</button>' +
            '</div>' +
            '<div id="categoriesList"><div class="loading">Loading...</div></div>' +
        '</div>' +
        '<div id="categoryModal" class="modal-overlay">' +
            '<div class="modal">' +
                '<div class="modal-content">' +
                    '<button class="modal-close" id="categoryModalClose" aria-label="Close">' +
                        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                    '</button>' +
                    '<h2 id="categoryModalTitle">' + S.addCategory + '</h2>' +
                    '<form id="categoryForm">' +
                        '<div class="form-group"><label>' + S.categoryNameKu + '</label><input type="text" id="categoryNameKu" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameAr + '</label><input type="text" id="categoryNameAr" required></div>' +
                        '<div class="form-group"><label>' + S.categoryNameEn + '</label><input type="text" id="categoryNameEn" required></div>' +
                        '<div class="form-group"><label>' + S.categoryImage + '</label>' +
                            '<input type="file" accept="image/*" id="categoryImageFile" style="margin-bottom:6px;">' +
                            '<input type="text" id="categoryImageURL" placeholder="' + (S.imageUrlOrUpload || 'Paste image URL or upload above') + '">' +
                            '<img id="categoryImagePreview" class="admin-img-preview" style="display:none;margin-top:8px;max-height:120px;max-width:100%;width:auto;height:auto;border-radius:8px;object-fit:contain;"></div>' +
                        '<div class="modal-actions">' +
                        '<button type="submit" class="btn-primary">' + S.saveCategory + '</button>' +
                        '<button type="button" class="btn-secondary" id="cancelCategoryBtn">' + S.cancel + '</button>' +
                        '</div>' +
                        '<input type="hidden" id="categoryId" value="">' +
                    '</form>' +
                '</div>' +
            '</div>' +
        '</div>';
    loadCategoriesList();
    wireCategoryEvents();
}

/* Distinct category names actually used by the menu items (so the manager can
   list/edit categories like "Coffee" even before a category document exists). */
function getMenuCategoryNames() {
    var names = {};
    try {
        JSON.parse(localStorage.getItem('cachedCashierItems') || '[]').forEach(function (it) {
            var c = it && it.v && it.v.category;
            if (c) names[c] = true;
        });
    } catch (e) {}
    try {
        JSON.parse(localStorage.getItem('cachedMenuCategoryNames') || '[]').forEach(function (n) {
            if (n) names[n] = true;
        });
    } catch (e) {}
    return names;
}

function renderCategoriesTable(categories) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var list = document.getElementById('categoriesList');
    if (!list) return;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var sortColLabel = (lang === 'ku') ? 'ڕیزبەندی' : ((lang === 'ar') ? 'الترتيب' : 'Order');

    if (!categories || !categories.length) {
        list.innerHTML = '<p style="color:var(--text-muted);padding:8px 2px;">' + S.noCategories + '</p>';
        return;
    }

    try {
        categories.sort(function (a, b) {
            var ao = (a.data && a.data.order) != null ? Number(a.data.order) : null;
            var bo = (b.data && b.data.order) != null ? Number(b.data.order) : null;
            if (ao != null && bo != null) {
                if (ao !== bo) return ao - bo;
                return String(a.id).localeCompare(String(b.id));
            }
            if (ao != null) return -1;
            if (bo != null) return 1;
            var ai = safeCategoryPreferredIndex(a);
            var bi = safeCategoryPreferredIndex(b);
            if (ai !== bi) return ai - bi;
            return String(a.id).localeCompare(String(b.id));
        });
    } catch (sortErr) {
        console.warn('[admin categories] sort failed, using original order:', sortErr);
    }

    _currentAdminCategories = categories;

    var html = '<div class="table-responsive"><table class="admin-table admin-table--categories"><thead><tr><th class="admin-th-sort">' + escapeHtmlText(sortColLabel) + '</th><th>' + (S.image || 'Image') + '</th><th>' + (S.name || 'Name') + '</th><th>' + (S.actions || 'Actions') + '</th></tr></thead><tbody>';
    try {
        categories.forEach(function (c, idx) {
            try {
                var cat = (c && c.data) || {};
                var name = cat['name_' + lang] || cat.name_ku || cat.name_ar || cat.name_en || (c && c.id) || S.unnamed;
                var img = cat.image || 'https://placehold.co/50x50?text=No+Image';
                var virtualBadge = c.virtual ? ' <span class="cat-virtual-badge">' + (S.fromMenu || 'from menu') + '</span>' : '';
                var actions = '<button type="button" class="btn-primary btn-sm edit-category" data-id="' + escapeHtmlAttr(c.id) + '"' + (c.virtual ? ' data-virtual="1"' : '') + '>' + (c.virtual ? (S.addCategory || 'Add') : S.edit) + '</button>';
                if (!c.virtual) {
                    actions += '<button type="button" class="btn-danger btn-sm delete-category" data-id="' + escapeHtmlAttr(c.id) + '">' + S.delete + '</button>';
                }
                html += '<tr class="admin-row" data-id="' + escapeHtmlAttr(c.id) + '">' +
                    '<td class="admin-sort-col" data-label="' + escapeHtmlAttr(sortColLabel) + '">' +
                        '<div class="admin-sort-cell">' +
                            '<span class="admin-drag-grip" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>' +
                            '<span class="admin-order-num">' + (idx + 1) + '</span>' +
                            '<div class="admin-reorder-btns">' +
                                '<button type="button" class="btn-reorder move-cat-up" data-id="' + escapeHtmlAttr(c.id) + '" ' + (idx === 0 ? 'disabled' : '') + ' title="Move Up">▲</button>' +
                                '<button type="button" class="btn-reorder move-cat-down" data-id="' + escapeHtmlAttr(c.id) + '" ' + (idx === categories.length - 1 ? 'disabled' : '') + ' title="Move Down">▼</button>' +
                            '</div>' +
                        '</div>' +
                    '</td>' +
                    '<td data-label="' + escapeHtmlAttr(S.image || 'Image') + '"><img src="' + escapeHtmlAttr(img) + '" alt="" width="48" height="48" style="border-radius:8px;object-fit:cover;" onerror="this.src=\'https://placehold.co/50x50?text=Error\'"></td>' +
                    '<td data-label="' + escapeHtmlAttr(S.name || 'Name') + '">' + escapeHtmlText(name) + virtualBadge + '</td>' +
                    '<td data-label="' + escapeHtmlAttr(S.actions || 'Actions') + '" class="admin-row-actions">' + actions + '</td>' +
                    '</tr>';
            } catch (rowErr) {
                console.warn('[admin categories] row render error:', rowErr, c);
            }
        });
    } catch (forEachErr) {
        console.warn('[admin categories] forEach failed:', forEachErr);
    }
    html += '</tbody></table></div>';
    list.innerHTML = html;

    var tbodyEl = list.querySelector('tbody');
    if (tbodyEl) {
        enableTouchAndDragReorder(tbodyEl, function (newIds) {
            reorderCategoriesByIds(newIds);
        });
    }

    try {
        function handleCategoryClick(e) {
            var upBtn = e.target.closest('.move-cat-up');
            if (upBtn) {
                e.preventDefault();
                e.stopPropagation();
                moveCategoryByStep(upBtn.getAttribute('data-id'), -1);
                return;
            }
            var downBtn = e.target.closest('.move-cat-down');
            if (downBtn) {
                e.preventDefault();
                e.stopPropagation();
                moveCategoryByStep(downBtn.getAttribute('data-id'), 1);
                return;
            }
            var editBtn = e.target.closest('.edit-category');
            if (editBtn) {
                editCategory(editBtn.getAttribute('data-id'));
                return;
            }
            var deleteBtn = e.target.closest('.delete-category');
            if (deleteBtn) {
                deleteCategory(deleteBtn.getAttribute('data-id'));
            }
        }
        if (list._categoryClickHandler) {
            list.removeEventListener('click', list._categoryClickHandler);
            list.removeEventListener('pointerdown', list._categoryClickHandler);
        }
        list._categoryClickHandler = handleCategoryClick;
        list.addEventListener('click', handleCategoryClick);
    } catch (evErr) {
        console.warn('[admin categories] event wiring failed:', evErr);
    }
}

function mergeMenuCategories(realCats, haveIds) {
    var merged = realCats.slice();
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var menuNames = getMenuCategoryNames();
    var normalizedRealIds = {};
    realCats.forEach(function (c) {
        if (c && c.id) normalizedRealIds[normalizeCategoryId(c.id)] = true;
    });
    Object.keys(menuNames).forEach(function (name) {
        if (normalizedRealIds[normalizeCategoryId(name)]) return;
        var label = getCategoryLabel(name, lang, buildCategoryMapFromCache());
        merged.push({
            id: name,
            data: { name_ku: label, name_ar: label, name_en: label, image: '' },
            virtual: true
        });
    });
    return merged;
}

function loadCategoriesList() {
    var list = document.getElementById('categoriesList');
    if (!list) return;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

    // Show cached categories immediately (includes ones just saved offline).
    renderCategoriesListNow();

    // Always prefer a fresh server read so paper-menu sync shows in Admin.
    if (!USE_LOCAL_API && window.db && navigator.onLine) {
        getDocs(collection(db, 'categories'), { source: 'server' }).then(function (snap) {
            var categories = [];
            snap.forEach(function (doc) {
                categories.push({ id: doc.id, data: doc.data() || {} });
            });
            categories.sort(function (a, b) {
                var ao = a.data && a.data.order != null ? Number(a.data.order) : 9999;
                var bo = b.data && b.data.order != null ? Number(b.data.order) : 9999;
                if (ao !== bo) return ao - bo;
                return String(a.id).localeCompare(String(b.id));
            });
            safeSetItem('cachedCategories', JSON.stringify(categories));
            // Show exactly what is in Firebase (no leftover virtual/extra categories).
            renderCategoriesTable(categories);
        }).catch(function () { /* fallback to MenuData path below */ });
    }

    if (USE_LOCAL_API) {
        localApiRequest('categories.php').then(function(cats) {
            var merged = mergeCategoryLists(cats.map(function(c) { return { id: c.id, data: c }; }), readCachedCategories());
            safeSetItem('cachedCategories', JSON.stringify(merged));
            var have = {};
            merged.forEach(function(c) { have[c.id] = true; });
            renderCategoriesTable(mergeMenuCategories(merged, have));

            // Also update menu category names from items
            localApiRequest('menu_items.php').then(function(items) {
                var names = {};
                items.forEach(function(it) { if (it.category) names[it.category] = true; });
                localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(names)));
                renderCategoriesListNow();
            }).catch(function() {});
        }).catch(function(err) {
            console.warn('[admin categories] Local API failed:', err.message);
            renderCategoriesListNow();
        });
        return;
    }

    if (!window.db) {
        if (!readCachedCategories().length) {
            clearAdminLoadingEl('categoriesList', '<p style="color:var(--text-muted);padding:8px 2px;">' + S.noCategories + '</p>');
        }
        return;
    }

    function applyCategories(categories) {
        var merged = mergeCategoryLists(categories, readCachedCategories());
        safeSetItem('cachedCategories', JSON.stringify(merged));
        var have = {};
        merged.forEach(function (c) { have[c.id] = true; });
        renderCategoriesTable(mergeMenuCategories(merged, have));
    }

    if (MenuData.getCategories().length) {
        applyCategories(MenuData.getCategories());
    }

    var isMobileCat = window.innerWidth <= 1024 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var catTimeout = isMobileCat ? 6000 : 3000;
    var catSafetyTimeout = isMobileCat ? 8000 : 5000;

    var catLoadTimer = setTimeout(function () {
        var el = document.getElementById('categoriesList');
        if (!el) return;
        if (renderCategoriesListNow()) return;
        if (el.querySelector('.loading') || !el.textContent.trim()) {
            fetchCategoriesForAdmin(12000).then(function (categories) {
                if (categories && categories.length > 0) {
                    applyCategories(categories);
                } else {
                    el.innerHTML = '<p style="color:var(--text-muted);">' + (S.menuConnectionHint || 'Check your connection and try again.') + '</p>';
                }
            }).catch(function () {
                if (!renderCategoriesListNow()) {
                    el.innerHTML = '<p style="color:var(--text-muted);">' + (S.menuConnectionHint || 'Check your connection and try again.') + '</p>';
                }
            });
        }
    }, catSafetyTimeout);

    MenuData.loadCategories(catTimeout, function (categories) {
        clearTimeout(catLoadTimer);
        applyCategories(categories);
    }, function (err) {
        clearTimeout(catLoadTimer);
        if (isFirestoreApiDisabledError(err)) {
            showFirestoreApiDisabledAlert();
        }
        fetchCategoriesForAdmin(12000).then(function (categories) {
            if (categories && categories.length > 0) {
                applyCategories(categories);
            } else {
                renderCategoriesListNow();
            }
        }).catch(function () {
            renderCategoriesListNow();
        });
    });

    function applyMenuNamesFromItems(items) {
        var names = {};
        items.forEach(function (it) {
            var c = it && it.category;
            if (c) names[c] = true;
        });
        localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(Object.keys(names)));
        clearTimeout(catLoadTimer);
        renderCategoriesListNow();
    }
    if (MenuData.getItems().length) {
        applyMenuNamesFromItems(MenuData.getItems());
    } else {
        MenuData.loadItems(8000, function (items) {
            clearTimeout(catLoadTimer);
            applyMenuNamesFromItems(items);
        }, function () { clearTimeout(catLoadTimer); });
    }
}

function wireCategoryEvents() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var addBtn = document.getElementById('addCategoryBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            document.getElementById('categoryModalTitle').textContent = S.addCategory;
            document.getElementById('categoryForm').reset();
            document.getElementById('categoryId').value = '';
            var pr = document.getElementById('categoryImagePreview');
            if (pr) pr.style.display = 'none';
            openAdminModal(document.getElementById('categoryModal'));
        });
    }

    var closeBtn = document.getElementById('categoryModalClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            closeAdminModal(document.getElementById('categoryModal'));
        });
    }

    var cancelBtn = document.getElementById('cancelCategoryBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            closeAdminModal(document.getElementById('categoryModal'));
        });
    }

    var form = document.getElementById('categoryForm');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            saveCategory();
        });
    }

    // Image URL preview with validation
    var imageInput = document.getElementById('categoryImageURL');
    if (imageInput) {
        imageInput.addEventListener('input', function () {
            var url = this.value.trim();
            var preview = document.getElementById('categoryImagePreview');
            if (url) {
                preview.src = url;
                preview.style.display = 'block';
                preview.onerror = function () {
                    console.error('Invalid image URL:', url);
                    this.style.display = 'none';
                };
            } else {
                preview.style.display = 'none';
            }
        });
    }
    wireImageFileInput('categoryImageFile', 'categoryImageURL', 'categoryImagePreview');
}

function syncCategoriesFromItems() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!confirm(S.syncCategoriesConfirm || 'Create editable category entries from the categories used by your menu items?')) return;

    getDocs(collection(db, 'menuItems')).then(function (itemSnap) {
        var names = {};
        itemSnap.forEach(function (d) {
            var c = (d.data() || {}).category;
            if (c && c.toLowerCase().trim() !== 'water') names[c] = true;
        });
        return getDocs(collection(db, 'categories')).then(function (catSnap) {
            var have = {};
            var maxOrder = -1;
            catSnap.forEach(function (d) {
                have[d.id] = true;
                var o = Number((d.data() || {}).order);
                if (!isNaN(o) && o > maxOrder) maxOrder = o;
            });

            var batch = writeBatch(db);
            var count = 0;
            Object.keys(names).forEach(function (name) {
                if (have[name]) return;
                // Use the name as the document id so existing items (which
                // reference the category by this value) keep matching.
                var ref = doc(db, 'categories', name);
                maxOrder += 1;
                batch.set(ref, {
                    name_ku: name, name_ar: name, name_en: name,
                    image: '',
                    order: maxOrder,
                    created_at: serverTimestamp(),
                    updated_at: serverTimestamp()
                });
                count++;
            });

            if (count === 0) { alert(S.noNewCategories || 'All categories are already added.'); return; }
            applyWrite(batch.commit(), function (offline) {
                loadCategoriesList();
                alert((offline ? S.categorySavedOffline : (S.categoriesSynced || 'Categories added:')) + ' ' + count);
            }, function (err) {
                alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
            }, MENU_SYNC_WRITE);
        });
    }).catch(function (e) { alert(S.errorPrefix + e.message); });
}

function saveCategory() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var nameKu = document.getElementById('categoryNameKu').value.trim();
    var nameAr = document.getElementById('categoryNameAr').value.trim();
    var nameEn = document.getElementById('categoryNameEn').value.trim();

    if (!nameKu || !nameAr || !nameEn) {
        alert(S.fillAll);
        return;
    }

    if (!window.db) {
        alert(S.itemSyncFailed + '\nFirebase not ready.');
        return;
    }
    if (!isAdminAuthenticated()) {
        alert(S.itemSyncFailed + '\nPlease log in again.');
        window.location.href = 'login.html';
        return;
    }

    var imgUrl = document.getElementById('categoryImageURL').value.trim();
    var placeholderImg = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%23e0e0e0 width=%27400%27 height=%27300%27/%3E%3Ctext x=%2750%25%27 y=%2750%25%27 font-size=%2724%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%23999%27%3ENo+Image%3C/text%3E%3C/svg%3E';
    var finalImg = imgUrl || placeholderImg;

    var categoryId = document.getElementById('categoryId').value.trim();
    var isCreate = !categoryId;
    if (isCreate) {
        categoryId = sanitizeCategoryDocId(nameEn, nameKu, nameAr);
    }

    var existing = readCachedCategories().find(function (c) { return c && c.id === categoryId; });
    var existingOrder = existing && existing.data && existing.data.order;
    var orderValue = (existingOrder != null && existingOrder !== '' && !isNaN(Number(existingOrder)))
        ? Number(existingOrder)
        : nextCategoryOrder();

    var now = new Date().toISOString();
    var plainData = {
        name_ku: nameKu,
        name_ar: nameAr,
        name_en: nameEn,
        image: finalImg,
        order: orderValue,
        updated_at: now
    };

    var promise;
    var savedId = categoryId;
    var catRef = doc(db, 'categories', categoryId);
    if (isCreate) {
        plainData.created_at = now;
    }
    var writeData = Object.assign({}, plainData, {
        updated_at: serverTimestamp()
    });
    if (isCreate) {
        writeData.created_at = serverTimestamp();
    }
    promise = setDoc(catRef, writeData, { merge: true });

    applyMenuCloudWrite({
        collection: 'categories',
        docId: savedId,
        isCreate: isCreate,
        sdkPromise: promise,
        plainData: plainData,
        onDone: function (offline) {
            upsertCachedCategory(savedId, plainData);
            closeAdminModal(document.getElementById('categoryModal'));
            loadCategoriesDropdown();
            refreshCategoriesCache(function () {
                renderCategoriesListNow();
            });
            alert(offline ? S.categorySavedOffline : S.categorySavedCloud);
        },
        onError: function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }
    });
}

function openCategoryModalWith(categoryId, cat, isNew) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = categoryId;
    document.getElementById('categoryNameKu').value = cat.name_ku || '';
    document.getElementById('categoryNameAr').value = cat.name_ar || '';
    document.getElementById('categoryNameEn').value = cat.name_en || '';
    var pr = document.getElementById('categoryImagePreview');
    if (cat.image) {
        document.getElementById('categoryImageURL').value = cat.image;
        if (pr) { pr.src = cat.image; pr.style.display = 'block'; }
    } else if (pr) {
        pr.style.display = 'none';
    }
    document.getElementById('categoryModalTitle').textContent = isNew ? S.addCategory : S.editCategory;
    openAdminModal(document.getElementById('categoryModal'));
}

function editCategory(categoryId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    getDoc(doc(db, 'categories', categoryId)).then(function (docSnap) {
        if (!snapExists(docSnap)) {
            // A menu-derived (virtual) category: prefill from its name so saving
            // creates a real, editable category document with this id.
            openCategoryModalWith(categoryId, { name_ku: categoryId, name_ar: categoryId, name_en: categoryId, image: '' }, true);
            return;
        }
        openCategoryModalWith(categoryId, docSnap.data(), false);
    }).catch(function (e) {
        // Offline / no server: still allow editing using the id as a starting point.
        openCategoryModalWith(categoryId, { name_ku: categoryId, name_ar: categoryId, name_en: categoryId, image: '' }, true);
    });
}

function deleteCategory(categoryId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!confirm(S.deleteCategoryConfirm)) return;

    var isVirtual = !readCachedCategories().some(function (c) { return c.id === categoryId; });

    if (isVirtual) {
        removeCategoryFromCacheAndUi(categoryId);
        alert((S.categoryDeleted || 'Category removed locally: ') + categoryId);
        return;
    }

    if (!window.db) {
        alert(S.itemSyncFailed + '\nFirebase not ready.');
        return;
    }

    firestoreGetWithTimeout(getDocs(collection(db, 'menuItems')), 8000).then(function (snap) {
        var catLower = normalizeCategoryId(categoryId);
        var batch = writeBatch(db);
        snap.forEach(function (doc) {
            var data = doc.data() || {};
            if (data.category && normalizeCategoryId(data.category) === catLower) {
                batch.delete(doc.ref);
            }
        });

        batch.delete(doc(db, 'categories', categoryId));

        applyWrite(batch.commit(), function () {
            removeCategoryFromCacheAndUi(categoryId);
            loadCategoriesList();
        }, function (err) {
            alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
        }, MENU_SYNC_WRITE);
    }).catch(function (e) {
        alert(S.errorPrefix + e.message);
    });
}

function removeCategoryFromCacheAndUi(categoryId) {
    var idLower = normalizeCategoryId(categoryId);
    var cats = readCachedCategories().filter(function (c) { return normalizeCategoryId(c.id) !== idLower; });
    safeSetItem('cachedCategories', JSON.stringify(cats));

    try {
        var names = JSON.parse(localStorage.getItem('cachedMenuCategoryNames') || '[]');
        var filtered = names.filter(function (n) { return normalizeCategoryId(n) !== idLower; });
        localStorage.setItem('cachedMenuCategoryNames', JSON.stringify(filtered));
    } catch (e) {}

    renderCategoriesListNow();
    refreshItemCategoryDropdown();
    refreshCategoryFilterOptions();
}

/* ============ ONE-TIME CATEGORY CLEANUP ============ */
/* Run once from admin.html?fixCategories=1 while logged in as admin.
   Merges mixed-case duplicate category documents into a single lowercase
   ID and rewrites every menu item's category field to lowercase. */

function maybeRunCategoryCleanup() {
    if (!window.location.search || !/[?&]fixCategories(?:=1)?(&|$)/.test(window.location.search)) return;
    whenAdminReady(function () {
        runCategoryCleanup();
    });
}

function chunkBatchOps(ops) {
    var limit = 450;
    var i = 0;
    function next() {
        if (i >= ops.length) return Promise.resolve();
        var slice = ops.slice(i, i + limit);
        i += limit;
        var b = db.batch();
        slice.forEach(function (op) {
            if (op.type === 'delete') b.delete(op.ref);
            else if (op.type === 'set') b.set(op.ref, op.data);
            else if (op.type === 'update') b.update(op.ref, op.data);
        });
        return b.commit().then(next);
    }
    return next();
}

function runCategoryCleanup() {
    if (!window.db) {
        alert('Firebase not ready. Try again.');
        return;
    }
    if (!isAdminAuthenticated()) {
        alert('Please log in as admin first, then reopen admin.html?fixCategories=1');
        return;
    }
    if (!confirm('Normalize all category IDs to lowercase, merge duplicates, and fix item categories in Firestore?\n\nThis modifies the database. Make a backup first. Continue?')) {
        return;
    }

    getDocs(collection(db, 'categories')).then(function (catSnap) {
        var groups = {};
        catSnap.forEach(function (doc) {
            var lower = doc.id.toLowerCase();
            if (!groups[lower]) groups[lower] = [];
            groups[lower].push({ id: doc.id, data: doc.data() || {}, ref: doc.ref });
        });

        var catOps = [];
        Object.keys(groups).forEach(function (lower) {
            var variants = groups[lower];
            var canonical = variants.slice().sort(function (a, b) {
                var ao = (a.data && a.data.order != null) ? 1 : 0;
                var bo = (b.data && b.data.order != null) ? 1 : 0;
                return bo - ao;
            })[0];
            var canonicalId = lower;
            variants.forEach(function (v) {
                if (v.id !== canonicalId) {
                    catOps.push({ type: 'delete', ref: v.ref });
                }
            });
            if (canonical.id !== canonicalId) {
                catOps.push({ type: 'set', ref: doc(db, 'categories', canonicalId), data: canonical.data });
            }
        });

        return chunkBatchOps(catOps).then(function () {
            try { localStorage.removeItem('cachedCategories'); } catch (e) {}
            try { localStorage.removeItem('cachedMenuCategoryNames'); } catch (e) {}
            alert('Category cleanup complete. Reloading admin…');
            window.location.href = 'admin.html';
        });
    }).catch(function (e) {
        alert('Cleanup failed: ' + (e && e.message ? e.message : e));
    });
}

/* ============ ONE-TIME CATEGORY RENAME ============ */
/* Run once from admin.html?renameCategory=old:new while logged in as admin.
   Rewrites all menu items from the old category name to the new one,
   deletes the old category doc(s), clears caches, and reloads. */

function maybeRunCategoryRename() {
    if (!window.location.search) return;
    var m = window.location.search.match(/[?&]renameCategory=([^:]+):([^&]+)/);
    if (!m) return;
    var oldName = m[1];
    var newName = m[2].trim();
    if (!oldName || !newName || oldName.toLowerCase() === newName.toLowerCase()) return;
    whenAdminReady(function () {
        runCategoryRename(oldName, newName);
    });
}

function runCategoryRename(oldName, newName) {
    if (!window.db) {
        alert('Firebase not ready. Try again.');
        return;
    }
    if (!isAdminAuthenticated()) {
        alert('Please log in as admin first, then reopen:\nadmin.html?renameCategory=' + encodeURIComponent(oldName + ':' + newName));
        return;
    }
    if (!confirm('Rename category "' + oldName + '" to "' + newName + '"?\n\nThis updates all menu items in Firestore and removes the old category doc. Make a backup first. Continue?')) {
        return;
    }

    var oldLower = oldName.toLowerCase();
    getDocs(collection(db, 'menuItems')).then(function (itemSnap) {
        var itemOps = [];
        itemSnap.forEach(function (docSnap) {
            var data = docSnap.data() || {};
            var cat = data.category;
            if (!cat || cat.toLowerCase() !== oldLower) return;
            itemOps.push({ type: 'update', ref: docSnap.ref, data: { category: newName } });
        });
        return chunkBatchOps(itemOps).then(function () {
            return Promise.all([
                deleteDoc(doc(db, 'categories', oldLower)),
                oldLower !== oldName ? deleteDoc(doc(db, 'categories', oldName)) : Promise.resolve()
            ]);
        });
    }).then(function () {
        try { localStorage.removeItem('cachedCategories'); } catch (e) {}
        try { localStorage.removeItem('cachedMenuCategoryNames'); } catch (e) {}
        try { localStorage.removeItem('cachedMenuItems'); } catch (e) {}
        alert('Category renamed from "' + oldName + '" to "' + newName + '". Reloading…');
        window.location.href = 'admin.html';
    }).catch(function (e) {
        alert('Rename failed: ' + (e && e.message ? e.message : e));
    });
}

/* ============ CASHIER ============ */

function stopCashierListener() {
    if (cashierUnsubscribe) {
        cashierUnsubscribe();
        cashierUnsubscribe = null;
    }
}

function invalidateCashierCache() {
    localStorage.removeItem('cachedCashierItems');
}

function normalizeCashierItemEntry(it) {
    if (!it) return null;
    if (it.v) {
        if (it.v.available === false || (it.v.category && it.v.category.toLowerCase().trim() === 'water')) return null;
        return it;
    }
    var id = it.id;
    if (!id) return null;
    var v = Object.assign({}, it);
    delete v.id;
    if (v.available === false || (v.category && v.category.toLowerCase().trim() === 'water')) return null;
    return { id: id, v: v };
}

function getCashierItemsFromLocalStorage() {
    var keys = ['cachedCashierItems', 'cachedMenuItems'];
    for (var i = 0; i < keys.length; i++) {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        try {
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length === 0) continue;
            var items = parsed.map(normalizeCashierItemEntry).filter(Boolean);
            if (items.length > 0) return items;
        } catch (e) {}
    }
    return [];
}

function showCashierEmptyState() {
    var grid = document.getElementById('cashierGrid');
    var catBar = document.getElementById('cashierCatBar');
    var S2 = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (catBar) {
        catBar.innerHTML = '<button class="cashier-cat-btn active" data-cat="all"><span class="cashier-cat-label">' + S2.allCategories + '</span></button>';
    }
    if (grid) grid.innerHTML = '<div class="cashier-empty">' + S2.noCategoryItems + '</div>';
}

function normalizeCashierItems(snapshot) {
    var items = [];
    snapshot.forEach(function (d) {
        var data = d.data();
        if (data.available === false) return;
        if (data.category && data.category.toLowerCase().trim() === 'water') return;
        items.push({ id: d.id, v: data });
    });
    return items;
}

function getCashierCategoryIcons() {
    return {
        'Coffee': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/924/924514.png" alt="Coffee">',
        'Tea': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/1223/1223749.png" alt="Tea">',
        'Cold Drinks': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/1113/1113278.png" alt="Cold Drinks">',
        'Dessert': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/8346/8346809.png" alt="Dessert">',
        'Shisha': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/10170/10170651.png" alt="Shisha">',
        'Special Drinks': '<img class="cashier-cat-icon" src="https://cdn-icons-png.flaticon.com/128/5473/5473500.png" alt="Special Drinks">'
    };
}

function renderCashierProducts(items) {
    var grid = document.getElementById('cashierGrid');
    var catBar = document.getElementById('cashierCatBar');
    if (!grid || !catBar) return;

    if (!items || items.length === 0) {
        showCashierEmptyState();
        return;
    }

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S2 = i18n[lang] || i18n.en;
    var catOrder = ['Coffee', 'Tea', 'Cold Drinks', 'Dessert', 'Shisha', 'Special Drinks'];
    var grouped = {};
    items.forEach(function (it) {
        var c = it.v.category || 'Other';
        if (!grouped[c]) grouped[c] = [];
        grouped[c].push(it);
    });
    var ordered = catOrder.filter(function (c) { return grouped[c]; });
    Object.keys(grouped).forEach(function (c) { if (ordered.indexOf(c) === -1) ordered.push(c); });

    var catMap2 = { Coffee: S2.coffee, Tea: S2.tea, 'Cold Drinks': S2.coldDrinks, Dessert: S2.dessert, Shisha: S2.shisha, 'Special Drinks': S2.specialDrinks };
    var categoryIcons = getCashierCategoryIcons();
    var catNameMap = buildCategoryMapFromCache();

    // Prefer the category's own (often uploaded => offline-safe) image.
    var catImageMap = {};
    readCachedCategories().forEach(function (c) {
        if (c && c.data && c.data.image) { catImageMap[c.id] = c.data.image; }
    });
    var fallbackSvg = '<svg class="cashier-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>';

    var catHtml = '<button class="cashier-cat-btn' + (cashierActiveFilter === 'all' ? ' active' : '') + '" data-cat="all"><span class="cashier-cat-label">' + S2.allCategories + '</span></button>';
    ordered.forEach(function (c) {
        var customImg = catImageMap[c];
        var icon = customImg
            ? '<img class="cashier-cat-icon" src="' + customImg + '" alt="" onerror="this.style.display=\'none\'">'
            : (categoryIcons[c] || fallbackSvg);
        var label = getCategoryLabel(c, lang, catNameMap);
        if (label === c && catMap2[c]) label = catMap2[c];
        catHtml += '<button class="cashier-cat-btn' + (cashierActiveFilter === c ? ' active' : '') + '" data-cat="' + c + '">' + icon + '<span class="cashier-cat-label">' + label + '</span></button>';
    });
    catBar.innerHTML = catHtml;

    function renderGrid(filterCat) {
        cashierActiveFilter = filterCat;
        var filtered = filterCat === 'all' ? items : items.filter(function (it) { return it.v.category === filterCat; });
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="cashier-empty">' + S2.noCategoryItems + '</div>';
            return;
        }
        var html = '';
        filtered.forEach(function (it) {
            var name = it.v['name_' + lang] || it.v.name_ku || it.v.name_ar || it.v.name_en || S2.unnamed;
            var price = it.v.price || 0;
            var img = it.v.image || '';
            html += '<div class="cashier-item-card" data-id="' + it.id + '" data-name="' + name + '" data-price="' + price + '">' +
                '<div class="cashier-item-img-wrap">' + (img ? '<img src="' + img + '" alt="' + name + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=cashier-item-noimg>☕</div>\'">' : '<div class="cashier-item-noimg">☕</div>') + '</div>' +
                '<div class="cashier-item-info"><div class="cashier-item-name">' + name + '</div><div class="cashier-item-price">' + price.toLocaleString() + ' <span>IQD</span></div></div>' +
                '<div class="cashier-item-add">+</div>' +
            '</div>';
        });
        grid.innerHTML = html;
        grid.querySelectorAll('.cashier-item-card').forEach(function (card) {
            card.addEventListener('click', function () {
                addToOrder(this.getAttribute('data-id'), this.getAttribute('data-name'), parseFloat(this.getAttribute('data-price')));
            });
        });
    }

    renderGrid(cashierActiveFilter);

    catBar.querySelectorAll('.cashier-cat-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            catBar.querySelectorAll('.cashier-cat-btn').forEach(function (b) { b.classList.remove('active'); });
            this.classList.add('active');
            renderGrid(this.getAttribute('data-cat'));
        });
    });
}

function loadCashier() {
    stopCashierListener();
    orderItems.length = 0;
    cashierActiveFilter = 'all';
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    var orderCountBadge = '<span class="cashier-order-count" id="cashierOrderCount">0</span>';
    adminContent.innerHTML =
        '<div class="cashier-layout">' +
            '<aside class="cashier-order" id="cashierOrderPanel">' +
                '<div class="cashier-order-header">' +
                    '<h3>' + S.currentOrder + orderCountBadge + '</h3>' +
                    '<div class="cashier-order-header-actions">' +
                        '<button class="btn-clear-order" id="clearOrderBtn">' + S.clear + '</button>' +
                        '<button class="cashier-order-toggle" id="cashierOrderToggle" aria-label="Toggle order">▲</button>' +
                    '</div>' +
                '</div>' +
                '<div class="cashier-order-items" id="cashierOrderItems">' +
                    '<div class="cashier-empty">' + S.noItemsAdded + '</div>' +
                '</div>' +
                '<div class="cashier-order-footer">' +
                    '<div class="cashier-total-row"><span>' + S.total + '</span><span class="cashier-total-amount" id="cashierTotal">0 IQD</span></div>' +
                    '<div class="cashier-actions">' +
                        '<button class="btn-print" id="printBtn">🖨️ ' + S.printReceipt + '</button>' +
                        '<button class="btn-pay" id="payBtn">' + S.payNow + '</button>' +
                    '</div>' +
                '</div>' +
            '</aside>' +
            '<section class="cashier-products">' +
                '<div class="cashier-categories" id="cashierCatBar"></div>' +
                '<div class="cashier-grid" id="cashierGrid"><div class="loading">Loading...</div></div>' +
            '</section>' +
        '</div>';

    loadCashierItems();
    wireCashierEvents();
    wireCashierOrderToggle();
}

function wireCashierOrderToggle() {
    var toggle = document.getElementById('cashierOrderToggle');
    var panel = document.getElementById('cashierOrderPanel');
    if (!toggle || !panel) return;
    if (window.innerWidth <= 1024) {
        panel.classList.remove('collapsed');
        return;
    }
    var collapsed = false;
    toggle.addEventListener('click', function () {
        collapsed = !collapsed;
        panel.classList.toggle('collapsed', collapsed);
        toggle.textContent = collapsed ? '▼' : '▲';
    });
}

function applyCashierItemsSnap(snap) {
    if (snap.empty) {
        if (getCashierItemsFromLocalStorage().length > 0) {
            loadCashierItemsFromCache();
            return;
        }
        if (isFirestoreCacheEmptySnap(snap)) return;
        showCashierEmptyState();
        return;
    }
var items = normalizeCashierItems(snap);
safeSetItem('cachedCashierItems', JSON.stringify(items));
    var menuCache = [];
    snap.forEach(function (d) {
        menuCache.push(Object.assign({ id: d.id }, d.data()));
    });
    writeCachedMenuItemsFlat(menuCache);
    refreshCategoriesCache(function () {
        if (items.length > 0) {
            renderCashierProducts(items);
        } else {
            showCashierEmptyState();
        }
    });
}

function loadCashierItems() {
    var grid = document.getElementById('cashierGrid');
    var cachedItems = getCashierItemsFromLocalStorage();

    if (cachedItems.length > 0) {
        renderCashierProducts(cachedItems);
    } else if (grid) {
        grid.innerHTML = '<div class="loading">Loading...</div>';
    }

    if (!window.db) {
        if (cachedItems.length === 0) showCashierEmptyState();
        return;
    }

    stopCashierListener();

    adminGetWithTimeout(getDocs(collection(db, 'menuItems')), 8000).then(applyCashierItemsSnap).catch(function (e) {
        console.warn('[cashier] get failed:', e.message);
        loadCashierItemsFromCache();
    });

    if (navigator.onLine) {
        fetchMenuItemsForAdmin(12000).then(function (flatItems) {
            if (!flatItems || !flatItems.length) return;
            writeCachedMenuItemsFlat(flatItems);
            var items = flatItems.filter(function (it) {
                return it && it.available !== false && !(it.category && it.category.toLowerCase().trim() === 'water');
            }).map(function (it) {
                var v = Object.assign({}, it);
                var id = v.id;
                delete v.id;
                return { id: id, v: v };
            });
            safeSetItem('cachedCashierItems', JSON.stringify(items));
            if (items.length > 0) renderCashierProducts(items);
        }).catch(function (e) {
            console.warn('[cashier] REST fallback:', e.message || e);
        });
    }

    cashierUnsubscribe = onSnapshot(collection(db, 'menuItems'), applyCashierItemsSnap, function (e) {
        console.error('Error loading cashier items:', e);
        loadCashierItemsFromCache();
    });
}

function loadCashierItemsFromCache() {
    var items = getCashierItemsFromLocalStorage();
    if (items.length === 0) {
        showCashierEmptyState();
        return;
    }
    console.log('Loaded cashier items from cache:', items.length);
    renderCashierProducts(items);
}

function wireCashierEvents() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var payBtn = document.getElementById('payBtn');
    if (payBtn) {
        payBtn.addEventListener('click', function () {
            if (orderItems.length === 0) { alert(S.addFirst); return; }
            var total = recordCashierSale(orderItems.slice());
            if (total === null) return;
            alert(S.paymentSuccess + total.toLocaleString() + ' IQD');
        });
    }

    var clearBtn = document.getElementById('clearOrderBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            if (orderItems.length === 0) return;
            orderItems.length = 0;
            updateOrderDisplay();
        });
    }

    var printBtn = document.getElementById('printBtn');
    if (printBtn) {
        printBtn.addEventListener('click', function () {
            if (orderItems.length === 0) { alert(S.addFirst); return; }
            var itemsCopy = orderItems.slice();
            printReceipt(itemsCopy);
            recordCashierSale(itemsCopy);
        });
    }
}

function recordCashierSale(items) {
    if (!items || items.length === 0) return null;
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var total = items.reduce(function (s, i) { return s + i.price * i.quantity; }, 0);
    var now = new Date();
    var tempId = 'local-' + Date.now();
    var cacheEntry = {
        id: tempId,
        items: items.map(function (i) { return { name: i.name, price: i.price, quantity: i.quantity }; }),
        total: total,
        timestampSeconds: Math.floor(now.getTime() / 1000),
        cashier: (window.auth && auth.currentUser) ? auth.currentUser.email : S.unknown
    };
    upsertCachedSale(cacheEntry);

    var saleWrite = addDoc(collection(db, 'sales'), {
        items: cacheEntry.items,
        total: total,
        timestamp: Timestamp.fromDate(now),
        created_at: serverTimestamp(),
        cashier: cacheEntry.cashier
    });
    applyWrite(saleWrite, function () {
        orderItems.length = 0;
        updateOrderDisplay();
    });
    if (saleWrite && typeof saleWrite.then === 'function') {
        saleWrite.then(function (ref) {
            if (ref && ref.id) {
                removeCachedSale(tempId);
                upsertCachedSale(Object.assign({}, cacheEntry, { id: ref.id }));
            }
        }).catch(function (err) {
            console.error('Sale sync error (will retry when online):', err);
        });
    }
    return total;
}

function addToOrder(id, name, price) {
    var existing = orderItems.find(function (i) { return i.id === id; });
    if (existing) { existing.quantity += 1; }
    else { orderItems.push({ id: id, name: name, price: price, quantity: 1 }); }
    updateOrderDisplay();
}

function escapeReceiptHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatReceiptPhone(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.indexOf('964') === 0) {
        return '+964 ' + digits.slice(3, 6) + ' ' + digits.slice(6, 9) + ' ' + digits.slice(9);
    }
    return '+' + digits;
}

var RECEIPT_PRINT_WIDTH_PX = 240; /* XP-80 — safe width, left-aligned */

function buildReceiptPrintHtml(options) {
    var itemsHtml = '';
    var itemCount = 0;
    var w = RECEIPT_PRINT_WIDTH_PX;
    var lang = options.lang || 'ku';
    var langClass = 'lang-' + (lang === 'ar' || lang === 'en' ? lang : 'ku');
    var LRM = '\u200E';

    options.items.forEach(function (item, idx) {
        itemCount += item.quantity;
        var subtotal = item.price * item.quantity;
        var calcLine = LRM + item.quantity + ' × ' + item.price.toLocaleString() + ' = ' + subtotal.toLocaleString();

        itemsHtml +=
            '<div class="item">' +
                '<div class="item-top">' +
                    '<span class="item-name">' + escapeReceiptHtml(item.name) + '</span>' +
                    '<span class="item-amt">' + subtotal.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="item-calc">' + escapeReceiptHtml(calcLine) + ' IQD</div>' +
            '</div>';
        if (idx < options.items.length - 1) {
            itemsHtml += '<hr class="item-line">';
        }
    });

    return '<!DOCTYPE html>' +
    '<html lang="' + escapeReceiptHtml(options.lang) + '" dir="ltr">' +
    '<head>' +
        '<meta charset="UTF-8">' +
        '<title>Receipt</title>' +
        '<style>' +
            '@page { margin: 0; size: auto; }' +
            '* { box-sizing: border-box; margin: 0; padding: 0; }' +
            'html { width: ' + w + 'px; max-width: ' + w + 'px; }' +
            'body {' +
                'width: ' + w + 'px; max-width: ' + w + 'px;' +
                'margin: 0; padding: 4px 14px 8px 4px;' +
                'font-family: Tahoma, Arial, sans-serif;' +
                'font-size: 10px; line-height: 1.28; color: #000; background: #fff;' +
                'direction: ltr; text-align: left;' +
                '-webkit-print-color-adjust: exact; print-color-adjust: exact;' +
            '}' +
            '.receipt { width: 100%; max-width: 100%; overflow: hidden; }' +
            '.brand-logo { display: block; width: 28px; height: 28px; margin: 0 auto 3px; border-radius: 50%; object-fit: cover; }' +
            '.rule { border: none; border-top: 1px dashed #000; margin: 4px 0; width: 100%; }' +
            '.rule-solid { border: none; border-top: 1px solid #000; margin: 4px 0; width: 100%; }' +
            '.brand-title { font-family: Georgia, "Times New Roman", serif; font-size: 11px; font-weight: 700; text-align: center; line-height: 1.2; margin-bottom: 1px; }' +
            '.brand-title .en { direction: ltr; unicode-bidi: embed; }' +
            '.brand-title .sep { opacity: 0.4; padding: 0 2px; }' +
            '.brand-title .ku { font-weight: 700; direction: rtl; unicode-bidi: embed; }' +
            '.brand-tagline { text-align: center; font-size: 7px; letter-spacing: 0.1em; text-transform: uppercase; color: #444; }' +
            '.brand-location { text-align: center; font-size: 9px; color: #222; margin-top: 1px; direction: rtl; unicode-bidi: plaintext; }' +
            '.meta-receipt { text-align: center; font-size: 9px; font-weight: 700; margin-bottom: 3px; }' +
            '.meta-datetime { width: 100%; margin: 2px 0; }' +
            '.meta-date, .meta-time { font-size: 9px; font-weight: 600; direction: ltr; unicode-bidi: embed; text-align: center; line-height: 1.35; }' +
            '.meta-pieces { text-align: center; font-size: 8px; color: #333; margin-top: 2px; }' +
            'body.lang-ku .meta-receipt, body.lang-ku .meta-pieces, body.lang-ku .thanks-main, body.lang-ku .brand-location { direction: rtl; unicode-bidi: plaintext; }' +
            'body.lang-ar .meta-receipt, body.lang-ar .meta-pieces, body.lang-ar .thanks-main, body.lang-ar .brand-location { direction: rtl; unicode-bidi: plaintext; }' +
            '.items-wrap { margin: 2px 0; width: 100%; max-width: 100%; }' +
            '.item { padding: 3px 0; width: 100%; max-width: 100%; }' +
            '.item-top { display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; width: 100%; max-width: 100%; gap: 4px; }' +
            '.item-name { flex: 1 1 auto; min-width: 0; font-weight: 700; font-size: 10px; word-wrap: break-word; overflow-wrap: break-word; }' +
            '.item-amt { flex: 0 0 auto; max-width: 42%; font-weight: 700; font-size: 10px; direction: ltr; unicode-bidi: embed; white-space: nowrap; }' +
            'body.lang-ku .item-top, body.lang-ar .item-top { flex-direction: row-reverse; }' +
            'body.lang-ku .item-name, body.lang-ar .item-name { text-align: right; direction: rtl; unicode-bidi: plaintext; }' +
            'body.lang-ku .item-amt, body.lang-ar .item-amt { text-align: left; }' +
            'body.lang-en .item-name { text-align: left; direction: ltr; }' +
            'body.lang-en .item-amt { text-align: right; }' +
            '.item-calc { text-align: center; width: 100%; max-width: 100%; font-size: 8px; color: #333; margin-top: 2px; direction: ltr; unicode-bidi: embed; overflow: hidden; }' +
            '.item-line { border: none; border-top: 1px dashed #000; margin: 0; height: 0; width: 100%; }' +
            '.total-box { border: 1.5px solid #000; border-radius: 4px; padding: 4px 5px; margin: 4px 0 3px; display: flex; flex-direction: row; justify-content: space-between; align-items: center; width: 100%; max-width: 100%; gap: 4px; }' +
            'body.lang-ku .total-box, body.lang-ar .total-box { flex-direction: row-reverse; }' +
            '.total-label { flex: 1 1 auto; min-width: 0; font-size: 9px; font-weight: 700; text-transform: uppercase; }' +
            '.total-value { flex: 0 0 auto; font-size: 11px; font-weight: 700; direction: ltr; unicode-bidi: embed; white-space: nowrap; max-width: 55%; }' +
            'body.lang-ku .total-label, body.lang-ar .total-label { text-align: right; direction: rtl; unicode-bidi: plaintext; }' +
            'body.lang-en .total-label { text-align: left; direction: ltr; }' +
            'body.lang-ku .total-value, body.lang-ar .total-value { text-align: left; }' +
            'body.lang-en .total-value { text-align: right; }' +
            '.total-currency { font-size: 7px; font-weight: 600; margin-left: 2px; }' +
            '.footer-thanks { text-align: center; margin-top: 4px; padding-top: 3px; border-top: 1px dashed #000; width: 100%; }' +
            '.thanks-main { font-size: 10px; font-weight: 700; margin-bottom: 1px; }' +
            '.thanks-sub { font-size: 7px; color: #444; text-align: center; }' +
            '.footer-contact { text-align: center; margin-top: 3px; font-size: 9px; width: 100%; }' +
            '.footer-contact .phone { font-weight: 700; direction: ltr; unicode-bidi: embed; }' +
            '@media print {' +
                'html, body { width: ' + w + 'px !important; max-width: ' + w + 'px !important; margin: 0 !important; padding: 2px 14px 6px 4px !important; }' +
                '@page { margin: 0; size: auto; }' +
            '}' +
        '</style>' +
    '</head>' +
    '<body class="' + langClass + '">' +
        '<div class="receipt">' +
            '<img class="brand-logo" src="' + escapeReceiptHtml(options.logoUrl || 'images/Brew-logo.png') + '" alt="" onerror="this.style.display=\'none\'">' +
             '<div class="brand-title"><span class="en">' + escapeReceiptHtml(localStorage.getItem('cafeNameEn') || 'BREW CAFE & REST') + '</span></div>' +
            '<div class="brand-tagline">Premium Coffee House</div>' +
            (options.location ? '<div class="brand-location">' + escapeReceiptHtml(options.location) + '</div>' : '') +
            '<hr class="rule">' +
            '<div class="meta-receipt">' + escapeReceiptHtml(options.labels.receipt) + ' #' + escapeReceiptHtml(options.receiptNo) + '</div>' +
            '<div class="meta-datetime">' +
                '<div class="meta-date">' + escapeReceiptHtml(options.labels.date) + ': ' + escapeReceiptHtml(options.dateStr) + '</div>' +
                '<div class="meta-time">' + escapeReceiptHtml(options.labels.time) + ': ' + escapeReceiptHtml(options.timeStr) + '</div>' +
            '</div>' +
            '<div class="meta-pieces">' + itemCount + ' ' + escapeReceiptHtml(options.labels.pieces) + '</div>' +
            '<hr class="rule-solid">' +
            '<div class="items-wrap">' + itemsHtml + '</div>' +
            '<hr class="rule">' +
            '<div class="total-box">' +
                '<span class="total-label">' + escapeReceiptHtml(options.labels.total) + '</span>' +
                '<span class="total-value">' + options.total.toLocaleString() + '<span class="total-currency">IQD</span></span>' +
            '</div>' +
            '<div class="footer-thanks">' +
                '<div class="thanks-main">' + escapeReceiptHtml(options.labels.thanksMain) + '</div>' +
                '<div class="thanks-sub">' + escapeReceiptHtml(options.labels.thanksSub) + '</div>' +
            '</div>' +
            (options.phone ? '<div class="footer-contact"><div class="phone">' + escapeReceiptHtml(options.phone) + '</div></div>' : '') +
        '</div>' +
    '</body></html>';
}

function printHtmlInFrame(html) {
    var w = RECEIPT_PRINT_WIDTH_PX + 'px';
    var frame = document.getElementById('receiptPrintFrame');
    if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'receiptPrintFrame';
        frame.title = 'Receipt print';
        frame.setAttribute('aria-hidden', 'true');
        document.body.appendChild(frame);
    }

    frame.style.cssText =
        'position:fixed;left:-9999px;top:0;width:' + w + ';min-width:' + w + ';max-width:' + w +
        ';height:800px;border:0;visibility:hidden;overflow:hidden;background:#fff';

    var win = frame.contentWindow;
    if (!win) {
        alert('Print failed. Please use Chrome or Edge.');
        return false;
    }

    var doc = win.document;
    doc.open();
    doc.write(html);
    doc.close();

    function runPrint() {
        try {
            win.focus();
            win.print();
        } catch (err) {
            console.error('Print error:', err);
            alert('Print failed. Please try again.');
        }
    }

    if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(function () {
            setTimeout(runPrint, 150);
        }).catch(function () {
            setTimeout(runPrint, 200);
        });
    } else {
        setTimeout(runPrint, 250);
    }

    return true;
}

function printReceipt(itemsOverride) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var lang = localStorage.getItem('selectedLang') || 'ku';
    var items = itemsOverride || orderItems;
    if (items.length === 0) {
        alert(S.addFirst || 'Add items first');
        return;
    }

    var now = new Date();
    var receiptLabels = {
        ku: {
            receipt: 'پسوڵە',
            date: 'بەروار',
            time: 'کات',
            pieces: 'دانە',
            total: 'کۆی گشتی',
            thanksMain: 'سوپاس بۆ سەردانتان!',
            thanksSub: 'Thank you · شكراً لزيارتكم'
        },
        ar: {
            receipt: 'فاتورة',
            date: 'التاريخ',
            time: 'الوقت',
            pieces: 'قطعة',
            total: 'الإجمالي',
            thanksMain: 'شكراً لزيارتكم!',
            thanksSub: 'Thank you · سوپاس بۆ سەردانتان'
        },
        en: {
            receipt: 'Receipt',
            date: 'Date',
            time: 'Time',
            pieces: 'pcs',
            total: 'Total',
            thanksMain: 'Thank you for visiting!',
            thanksSub: 'سوپاس · شكراً لزيارتكم'
        }
    };

    var labels = receiptLabels[lang] || receiptLabels.ku;
    var total = items.reduce(function (s, i) { return s + i.price * i.quantity; }, 0);
    var receiptNo = String(now.getTime()).slice(-6);
    var phone = formatReceiptPhone(localStorage.getItem('whatsappPhone') || '9647506454656');
    var location = localStorage.getItem('cafeLocationLabel') || 'بەحرکە-مجەمع';

    var logoUrl = new URL('images/Brew-logo.png', window.location.href).href;

    var receiptHTML = buildReceiptPrintHtml({
        lang: lang,
        items: items.slice(),
        total: total,
        receiptNo: receiptNo,
        dateStr: now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        timeStr: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        phone: phone,
        location: location,
        logoUrl: logoUrl,
        labels: labels
    });

    printHtmlInFrame(receiptHTML);
}

function setupAdminOfflineDetection() {
    var menuIndicator = document.getElementById('offlineIndicator');
    if (menuIndicator) menuIndicator.remove();

    window.addEventListener('online', function () {
        console.log('Admin: Back online — syncing data');
        scheduleAdminConnectionStatus(true);
        warmAdminOfflineCache(function () {
            refreshAdminCurrentSection();
        });
    });

    window.addEventListener('offline', function () {
        console.log('Admin: Gone offline');
        scheduleAdminConnectionStatus(false);
        hydrateAdminFromLocalCache();
        refreshAdminCurrentSection();
    });

    if (!navigator.onLine) scheduleAdminConnectionStatus(false);
}

var _adminStatusShowTimer = null;
var _adminStatusHideTimer = null;
var ADMIN_STATUS_DELAY_MS = 2000;
var ADMIN_STATUS_VISIBLE_MS = 3000;

function clearAdminStatusTimers() {
    if (_adminStatusShowTimer) { clearTimeout(_adminStatusShowTimer); _adminStatusShowTimer = null; }
    if (_adminStatusHideTimer) { clearTimeout(_adminStatusHideTimer); _adminStatusHideTimer = null; }
}

function hideAdminConnectionStatus() {
    var existing = document.getElementById('adminOfflineIndicator');
    if (!existing) return;
    existing.style.opacity = '0';
    setTimeout(function () { if (existing.parentNode) existing.remove(); }, 400);
}

function scheduleAdminConnectionStatus(online) {
    clearAdminStatusTimers();
    hideAdminConnectionStatus();
    _adminStatusShowTimer = setTimeout(function () {
        _adminStatusShowTimer = null;
        showAdminConnectionStatusNow(online);
        _adminStatusHideTimer = setTimeout(function () {
            _adminStatusHideTimer = null;
            hideAdminConnectionStatus();
        }, ADMIN_STATUS_VISIBLE_MS);
    }, ADMIN_STATUS_DELAY_MS);
}

function showAdminConnectionStatus(online) {
    scheduleAdminConnectionStatus(online);
}

function showAdminConnectionStatusNow(online) {
    var existing = document.getElementById('adminOfflineIndicator');
    if (existing) existing.remove();

    var lang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[lang] || i18n.en;

    var indicator = document.createElement('div');
    indicator.id = 'adminOfflineIndicator';
    indicator.style.cssText = 'position:fixed;top:70px;right:20px;color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;transition:opacity .4s ease;opacity:0;';

    var dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#fff;display:inline-block;';
    indicator.appendChild(dot);

    var label = document.createElement('span');
    if (online) {
        indicator.style.background = '#2E7D32';
        label.textContent = (S.backOnline || 'Back online — syncing');
    } else {
        indicator.style.background = '#C62828';
        label.textContent = (S.offlineMode || 'Offline Mode — changes will sync');
    }
    indicator.appendChild(label);
    document.body.appendChild(indicator);
    requestAnimationFrame(function () { indicator.style.opacity = '1'; });
}

function populateTestData() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    
    if (!confirm('This will add sample menu items for each category. Continue?')) return;
    
    getDocs(collection(db, 'categories')).then(function (snap) {
        if (snap.empty) {
            alert('No categories found. Please create categories first.');
            return;
        }
        
        var categories = [];
        snap.forEach(function (doc) {
            categories.push({ id: doc.id, data: doc.data() });
        });
        
        var sampleItems = [
            {
                name_ku: 'قاوەی تایبەت',
                name_ar: 'قهوة خاصة',
                name_en: 'Special Coffee',
                desc_ku: 'قاوەی تایبەت بە تامێکی جوان',
                desc_ar: 'قهوة خاصة بطعم جميل',
                desc_en: 'Special coffee with beautiful taste',
                price: 2500,
                image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400'
            },
            {
                name_ku: 'چای سەوز',
                name_ar: 'شاي أخضر',
                name_en: 'Green Tea',
                desc_ku: 'چای سەوزی تازە',
                desc_ar: 'شاي أخضر طازج',
                desc_en: 'Fresh green tea',
                price: 1500,
                image: 'https://images.unsplash.com/photo-1556881286-fc6915169721?w=400'
            },
            {
                name_ku: 'جوسەی پرتەقاڵ',
                name_ar: 'عصير برتقال',
                name_en: 'Orange Juice',
                desc_ku: 'جوسەی پرتەقاڵی تازە',
                desc_ar: 'عصير برتقال طازج',
                desc_en: 'Fresh orange juice',
                price: 3000,
                image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400'
            },
            {
                name_ku: 'کێک',
                name_ar: 'كيك',
                name_en: 'Cake',
                desc_ku: 'کێکی شیرین',
                desc_ar: 'كيك حلو',
                desc_en: 'Sweet cake',
                price: 4000,
                image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400'
            }
        ];
        
        var addedCount = 0;
        var promises = [];
        
        categories.forEach(function (cat, index) {
            var sample = sampleItems[index % sampleItems.length];
            var item = {
                name_ku: sample.name_ku,
                name_ar: sample.name_ar,
                name_en: sample.name_en,
                description_ku: sample.desc_ku,
                description_ar: sample.desc_ar,
                description_en: sample.desc_en,
                price: sample.price,
                image: sample.image,
                category: cat.id,
                available: true,
                createdBy: getCurrentAdminEmail() || ''
            };
            
            var promise = addDoc(collection(db, 'menuItems'), item).then(function () {
                addedCount++;
                console.log('Added item for category:', cat.data.name_en);
            }).catch(function (e) {
                console.error('Error adding item:', e);
            });
            
            promises.push(promise);
        });
        
        Promise.all(promises).then(function () {
            alert('Added ' + addedCount + ' sample items successfully!');
            loadItemsList();
        }).catch(function (e) {
            alert('Error: ' + e.message);
        });
    }).catch(function (e) {
        alert('Error loading categories: ' + e.message);
    });
}

function updateOrderDisplay() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var container = document.getElementById('cashierOrderItems');
    var totalEl = document.getElementById('cashierTotal');
    var countEl = document.getElementById('cashierOrderCount');
    if (!container) return;

    var totalQty = 0;
    if (countEl) {
        orderItems.forEach(function (i) { totalQty += i.quantity; });
        countEl.textContent = totalQty;
        countEl.style.display = totalQty > 0 ? '' : 'none';
    }

    if (orderItems.length === 0) {
        container.innerHTML = '<div class="cashier-empty">' + S.noItemsAdded + '</div>';
        if (totalEl) totalEl.textContent = '0 IQD';
        return;
    }

    var html = '';
    var total = 0;
    orderItems.forEach(function (item, idx) {
        var sub = item.price * item.quantity;
        total += sub;
        html += '<div class="cashier-order-item">' +
            '<div class="cashier-order-item-name">' + item.name + '</div>' +
            '<div class="cashier-order-item-price">' + item.price.toLocaleString() + ' IQD</div>' +
            '<div class="cashier-qty-control">' +
                '<button class="cashier-qty-btn minus" data-idx="' + idx + '">\u2212</button>' +
                '<span class="cashier-qty-val">' + item.quantity + '</span>' +
                '<button class="cashier-qty-btn plus" data-idx="' + idx + '">+</button>' +
            '</div>' +
            '<div class="cashier-order-item-subtotal">' + sub.toLocaleString() + '</div>' +
            '<button class="cashier-remove-btn" data-idx="' + idx + '">\u2715</button>' +
        '</div>';
    });
    container.innerHTML = html;
    if (totalEl) totalEl.textContent = total.toLocaleString() + ' IQD';

    container.querySelectorAll('.cashier-qty-btn.minus').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var i = parseInt(this.getAttribute('data-idx'));
            orderItems[i].quantity--;
            if (orderItems[i].quantity <= 0) orderItems.splice(i, 1);
            updateOrderDisplay();
        });
    });
    container.querySelectorAll('.cashier-qty-btn.plus').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var i = parseInt(this.getAttribute('data-idx'));
            orderItems[i].quantity++;
            updateOrderDisplay();
        });
    });
    container.querySelectorAll('.cashier-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            orderItems.splice(parseInt(this.getAttribute('data-idx')), 1);
            updateOrderDisplay();
        });
    });
}

/* ============ SETTINGS ============ */

function applyAdminAccent(accent) {
    var allowed = ['gold', 'emerald', 'sapphire', 'amethyst', 'ruby', 'sunset', 'rose', 'graphite', 'cyan'];
    if (allowed.indexOf(accent) === -1) accent = 'sapphire';
    document.documentElement.setAttribute('data-accent', accent);
    try { localStorage.setItem('adminAccent', accent); } catch (e) {}
    var themeMeta = { gold: '#D4AF37', emerald: '#10B981', sapphire: '#3B82F6', amethyst: '#8B5CF6', ruby: '#F43F5E', sunset: '#F97316', rose: '#EC4899', graphite: '#94A3B8', cyan: '#06B6D4' };
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeMeta[accent]) meta.setAttribute('content', themeMeta[accent]);
}
window.applyAdminAccent = applyAdminAccent;

function getCafeTimeMinuteOptions(parts, lang) {
    var opts = [];
    var seen = {};
    for (var m = 0; m < 60; m += 5) {
        var val = String(m).padStart(2, '0');
        opts.push({
            value: val,
            label: typeof toLocaleDigits === 'function' ? toLocaleDigits(val, lang) : val
        });
        seen[m] = true;
    }
    if (!seen[parts.minute]) {
        var customVal = String(parts.minute).padStart(2, '0');
        opts.push({
            value: customVal,
            label: typeof toLocaleDigits === 'function' ? toLocaleDigits(customVal, lang) : customVal
        });
        opts.sort(function (a, b) { return parseInt(a.value, 10) - parseInt(b.value, 10); });
    }
    return opts;
}

function buildCafeTimePickerMarkup(idPrefix, timeValue, fallback, S, lang) {
    lang = lang || localStorage.getItem('selectedLang') || 'ku';
    var parts = typeof parseCafeTimeParts === 'function'
        ? parseCafeTimeParts(timeValue, fallback)
        : { normalized: fallback, hour12: 2, minute: 0, isPm: idPrefix === 'cafeOpen' };
    var digits = function (n) {
        return typeof toLocaleDigits === 'function' ? toLocaleDigits(String(n), lang) : String(n);
    };
    var hourOpts = '';
    for (var h = 1; h <= 12; h++) {
        hourOpts += '<option value="' + h + '"' + (h === parts.hour12 ? ' selected' : '') + '>' + digits(h) + '</option>';
    }
    var minOpts = '';
    getCafeTimeMinuteOptions(parts, lang).forEach(function (item) {
        minOpts += '<option value="' + item.value + '"' + (parseInt(item.value, 10) === parts.minute ? ' selected' : '') + '>' + item.label + '</option>';
    });
    var periodAm = lang === 'ku' ? 'بەیانی' : (lang === 'ar' ? 'صباحاً' : 'AM');
    var periodPm = lang === 'ku' ? 'شەو' : (lang === 'ar' ? 'مساءً' : 'PM');
    var periodOpts =
        '<option value="am"' + (!parts.isPm ? ' selected' : '') + '>' + periodAm + '</option>' +
        '<option value="pm"' + (parts.isPm ? ' selected' : '') + '>' + periodPm + '</option>';
    var display = typeof formatCafeTimeForDisplay === 'function'
        ? formatCafeTimeForDisplay(parts.normalized, lang)
        : parts.normalized;

    return '<div class="cafe-time-picker" data-prefix="' + idPrefix + '">' +
        '<button type="button" class="cafe-time-picker-btn" id="' + idPrefix + 'TimeBtn" aria-expanded="false">' +
            '<i class="fa-regular fa-clock" aria-hidden="true"></i>' +
            '<span class="cafe-time-picker-btn-text" id="' + idPrefix + 'TimeLabel">' + display + '</span>' +
            '<i class="fa-solid fa-chevron-down cafe-time-picker-chevron" aria-hidden="true"></i>' +
        '</button>' +
        '<div class="cafe-time-picker-panel" id="' + idPrefix + 'TimePanel" hidden>' +
            '<div class="cafe-time-hourmin">' +
                '<select class="cafe-time-select" id="' + idPrefix + 'Hour" aria-label="hour">' + hourOpts + '</select>' +
                '<span class="cafe-time-colon">:</span>' +
                '<select class="cafe-time-select" id="' + idPrefix + 'Minute" aria-label="minute">' + minOpts + '</select>' +
            '</div>' +
            '<select class="cafe-time-select cafe-time-period" id="' + idPrefix + 'Period" aria-label="period">' + periodOpts + '</select>' +
            '<button type="button" class="btn-secondary cafe-time-apply-btn" id="' + idPrefix + 'TimeApply">' + (S.applyTime || (lang === 'ku' ? 'تەواو' : (lang === 'ar' ? 'تطبيق' : 'Apply'))) + '</button>' +
        '</div>' +
        '<input type="hidden" id="' + idPrefix + 'Time" value="' + parts.normalized + '">' +
    '</div>';
}

function readCafeTimePickerValue(prefix) {
    var hourEl = document.getElementById(prefix + 'Hour');
    var minEl = document.getElementById(prefix + 'Minute');
    var periodEl = document.getElementById(prefix + 'Period');
    if (!hourEl || !minEl || !periodEl || typeof buildCafeTimeFromParts !== 'function') return null;
    return buildCafeTimeFromParts(hourEl.value, minEl.value, periodEl.value === 'pm');
}

function updateCafeTimePickerDisplay(prefix, lang) {
    var hidden = document.getElementById(prefix + 'Time');
    var label = document.getElementById(prefix + 'TimeLabel');
    if (!hidden) return;
    var fallback = prefix === 'cafeOpen' ? '14:00' : '02:00';
    var normalized = typeof normalizeCafeTimeValue === 'function'
        ? normalizeCafeTimeValue(hidden.value, fallback)
        : hidden.value;
    hidden.value = normalized;
    if (label && typeof formatCafeTimeForDisplay === 'function') {
        label.textContent = formatCafeTimeForDisplay(normalized, lang);
    }
}

function applyCafeTimePicker(prefix, lang) {
    var val = readCafeTimePickerValue(prefix);
    if (!val) return;
    var hidden = document.getElementById(prefix + 'Time');
    if (hidden) hidden.value = val;
    updateCafeTimePickerDisplay(prefix, lang);
    var panel = document.getElementById(prefix + 'TimePanel');
    var btn = document.getElementById(prefix + 'TimeBtn');
    if (panel) {
        panel.hidden = true;
        panel.classList.remove('is-open');
    }
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('is-open');
    }
}

function syncCafeTimePickerFromStorage(prefix, lang) {
    var hidden = document.getElementById(prefix + 'Time');
    if (!hidden || typeof parseCafeTimeParts !== 'function') return;
    var storageKey = prefix === 'cafeOpen' ? 'cafeOpenTime' : 'cafeCloseTime';
    var fallback = prefix === 'cafeOpen' ? '14:00' : '02:00';
    var stored = localStorage.getItem(storageKey) || hidden.value;
    var parts = parseCafeTimeParts(stored, fallback);
    hidden.value = parts.normalized;

    var hourEl = document.getElementById(prefix + 'Hour');
    var minEl = document.getElementById(prefix + 'Minute');
    var periodEl = document.getElementById(prefix + 'Period');
    if (hourEl) hourEl.value = String(parts.hour12);
    if (minEl) {
        var minuteVal = String(parts.minute).padStart(2, '0');
        if (!minEl.querySelector('option[value="' + minuteVal + '"]')) {
            var opt = document.createElement('option');
            opt.value = minuteVal;
            opt.textContent = typeof toLocaleDigits === 'function' ? toLocaleDigits(minuteVal, lang) : minuteVal;
            minEl.appendChild(opt);
        }
        minEl.value = minuteVal;
    }
    if (periodEl) periodEl.value = parts.isPm ? 'pm' : 'am';
    updateCafeTimePickerDisplay(prefix, lang);
}

function setupCafeTimePickers(lang) {
    ['cafeOpen', 'cafeClose'].forEach(function (prefix) {
        var btn = document.getElementById(prefix + 'TimeBtn');
        var panel = document.getElementById(prefix + 'TimePanel');
        var applyBtn = document.getElementById(prefix + 'TimeApply');
        if (!btn || !panel) return;
        var pickerEl = btn.closest('.cafe-time-picker');

        function togglePicker(e) {
            if (e.target.closest('.cafe-time-picker-panel')) return;
            e.stopPropagation();
            var willOpen = panel.hidden;
            document.querySelectorAll('.cafe-time-picker-panel').forEach(function (p) {
                p.hidden = true;
                p.classList.remove('is-open');
            });
            document.querySelectorAll('.cafe-time-picker-btn').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
                b.classList.remove('is-open');
            });
            if (willOpen) {
                panel.hidden = false;
                panel.classList.add('is-open');
                btn.classList.add('is-open');
            }
            btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }

        if (pickerEl) pickerEl.addEventListener('click', togglePicker);
        else btn.addEventListener('click', togglePicker);

        if (applyBtn) {
            applyBtn.addEventListener('click', function () {
                applyCafeTimePicker(prefix, lang);
            });
        }

        ['Hour', 'Minute', 'Period'].forEach(function (part) {
            var el = document.getElementById(prefix + part);
            if (el) {
                el.addEventListener('change', function () {
                    applyCafeTimePicker(prefix, lang);
                });
            }
        });
    });

    if (!window._cafeTimePickerDocClose) {
        window._cafeTimePickerDocClose = true;
        document.addEventListener('click', function (e) {
            if (e.target.closest('.cafe-time-picker')) return;
            document.querySelectorAll('.cafe-time-picker-panel').forEach(function (p) {
                p.hidden = true;
                p.classList.remove('is-open');
            });
            document.querySelectorAll('.cafe-time-picker-btn').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
                b.classList.remove('is-open');
            });
        });
    }
}

/* ============ MENU OFFERS (hero slideshow) ============ */

function readCachedOffersAdmin() {
    try {
        var list = JSON.parse(localStorage.getItem('cachedMenuOffers') || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function writeCachedOffersAdmin(list) {
    try {
        localStorage.setItem('cachedMenuOffers', JSON.stringify(list || []));
    } catch (e) { /* ignore */ }
}

function sortOffersAdmin(list) {
    return (list || []).slice().sort(function (a, b) {
        var ao = a.order != null ? Number(a.order) : 0;
        var bo = b.order != null ? Number(b.order) : 0;
        if (ao !== bo) return ao - bo;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

function nextOfferOrder() {
    var max = -1;
    readCachedOffersAdmin().forEach(function (o) {
        var n = Number(o.order);
        if (!isNaN(n) && n > max) max = n;
    });
    return max + 1;
}

function loadManageOffers() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    adminContent.innerHTML =
        '<div class="card">' +
            '<h2>' + escapeHtmlText(S.manageOffers || 'Manage Offers') + '</h2>' +
            '<p class="settings-section-hint" style="margin-bottom:14px;">' + escapeHtmlText(S.offersHint || 'These images show at the top of the menu — each image for 3 seconds.') + '</p>' +
            '<button class="btn-primary" id="addOfferBtn" style="margin-bottom:16px;">' + escapeHtmlText(S.addOffer || 'Add Offer') + '</button>' +
            '<div id="offersList"><div class="loading">' + escapeHtmlText(S.loading || 'Loading...') + '</div></div>' +
        '</div>' +
        '<div id="offerModal" class="modal-overlay">' +
            '<div class="modal">' +
                '<div class="modal-content">' +
                    '<button class="modal-close" id="offerModalClose" aria-label="Close">' +
                        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                    '</button>' +
                    '<h2 id="offerModalTitle">' + escapeHtmlText(S.addOffer || 'Add Offer') + '</h2>' +
                    '<form id="offerForm">' +
                        '<div class="form-group"><label>' + escapeHtmlText(S.offerTitle || 'Title') + '</label>' +
                            '<input type="text" id="offerTitle" placeholder="Burger offer, Pizza, Shawarma..."></div>' +
                        '<div class="form-group"><label>' + escapeHtmlText(S.offerImage || 'Offer image') + '</label>' +
                            '<input type="file" accept="image/*" id="offerImageFile" style="margin-bottom:6px;">' +
                            '<input type="text" id="offerImageURL" placeholder="' + escapeHtmlAttr(S.imageUrlOrUpload || 'Paste image URL or upload above') + '">' +
                            '<img id="offerImagePreview" alt="" style="display:none;margin-top:8px;max-height:140px;max-width:100%;border-radius:10px;object-fit:cover;"></div>' +
                        '<div class="form-group"><label>' + escapeHtmlText(S.offerLink || 'Offer link') + '</label>' +
                            '<input type="url" id="offerLinkUrl" placeholder="https://..."></div>' +
                        '<div class="form-group"><label>' + escapeHtmlText(S.offerOrder || 'Order') + '</label>' +
                            '<input type="number" id="offerOrder" min="0" step="1" value="0"></div>' +
                        '<div class="form-group"><label><input type="checkbox" id="offerActive" checked> ' + escapeHtmlText(S.offerActive || 'Active on menu') + '</label></div>' +
                        '<div class="modal-actions">' +
                        '<button type="submit" class="btn-primary">' + escapeHtmlText(S.saveOffer || 'Save Offer') + '</button>' +
                        '<button type="button" class="btn-secondary" id="cancelOfferBtn">' + escapeHtmlText(S.cancel || 'Cancel') + '</button>' +
                        '</div>' +
                        '<input type="hidden" id="offerId" value="">' +
                    '</form>' +
                '</div>' +
            '</div>' +
        '</div>';

    wireOfferEvents();
    loadOffersList();
}

function renderOffersTable(offers) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var list = document.getElementById('offersList');
    if (!list) return;
    offers = sortOffersAdmin(offers || []);

    if (!offers.length) {
        list.innerHTML = '<p style="color:var(--text-muted);padding:8px 2px;">' + escapeHtmlText(S.noOffers || 'No offers yet.') + '</p>';
        return;
    }

    var html = '<div class="table-responsive"><table class="admin-table admin-table--offers"><thead><tr>' +
        '<th>' + escapeHtmlText(S.image || 'Image') + '</th>' +
        '<th>' + escapeHtmlText(S.name || 'Title') + '</th>' +
        '<th>' + escapeHtmlText(S.offerOrder || 'Order') + '</th>' +
        '<th>' + escapeHtmlText(S.offerActive || 'Active') + '</th>' +
        '<th>' + escapeHtmlText(S.actions || 'Actions') + '</th>' +
        '</tr></thead><tbody>';

    offers.forEach(function (o) {
        var img = o.image || '';
        var title = o.title || '—';
        var activeLabel = o.active !== false ? '✓' : '—';
        html += '<tr class="admin-row">' +
            '<td data-label="' + escapeHtmlAttr(S.image || 'Image') + '"><img src="' + escapeHtmlAttr(img) + '" alt="" width="72" height="48" style="border-radius:8px;object-fit:cover;background:#eee;" onerror="this.style.opacity=.3"></td>' +
            '<td data-label="' + escapeHtmlAttr(S.name || 'Title') + '">' + escapeHtmlText(title) + '</td>' +
            '<td data-label="' + escapeHtmlAttr(S.offerOrder || 'Order') + '">' + escapeHtmlText(String(o.order != null ? o.order : 0)) + '</td>' +
            '<td data-label="' + escapeHtmlAttr(S.offerActive || 'Active') + '">' + activeLabel + '</td>' +
            '<td data-label="' + escapeHtmlAttr(S.actions || 'Actions') + '" class="admin-row-actions">' +
                '<button type="button" class="btn-primary btn-sm edit-offer" data-id="' + escapeHtmlAttr(o.id) + '">' + escapeHtmlText(S.edit || 'Edit') + '</button>' +
                '<button type="button" class="btn-danger btn-sm delete-offer" data-id="' + escapeHtmlAttr(o.id) + '">' + escapeHtmlText(S.delete || 'Delete') + '</button>' +
            '</td></tr>';
    });
    html += '</tbody></table></div>';
    list.innerHTML = html;

    list.onclick = function (e) {
        var editBtn = e.target.closest('.edit-offer');
        if (editBtn) {
            editOffer(editBtn.getAttribute('data-id'));
            return;
        }
        var deleteBtn = e.target.closest('.delete-offer');
        if (deleteBtn) {
            deleteOffer(deleteBtn.getAttribute('data-id'));
        }
    };
}

function loadOffersList() {
    var listEl = document.getElementById('offersList');
    if (!listEl) return;

    var cached = readCachedOffersAdmin();
    if (cached.length) renderOffersTable(cached);

    if (!window.db) {
        if (!cached.length) {
            renderOffersTable([]);
        }
        return;
    }

    whenAdminReady(function () {
        if (!window.db) {
            renderOffersTable(readCachedOffersAdmin());
            return;
        }
        getDocs(collection(db, 'menuOffers')).then(function (snap) {
            var offers = [];
            snap.forEach(function (doc) {
                var d = doc.data() || {};
                offers.push({
                    id: doc.id,
                    image: d.image || '',
                    title: d.title || '',
                    linkUrl: d.linkUrl || '',
                    order: d.order != null ? Number(d.order) : 0,
                    active: d.active !== false
                });
            });
            writeCachedOffersAdmin(offers);
            renderOffersTable(offers);
        }).catch(function (err) {
            console.warn('[admin offers]', err && err.message);
            if (!readCachedOffersAdmin().length) {
                var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
                listEl.innerHTML = '<p style="color:#C62828;">' + escapeHtmlText((S.errorPrefix || 'Error:') + ' ' + (err.message || err)) + '</p>';
            } else {
                renderOffersTable(readCachedOffersAdmin());
            }
        });
    });
}

function wireOfferEvents() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var addBtn = document.getElementById('addOfferBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            openOfferModal('', {
                title: '',
                image: '',
                linkUrl: '',
                order: nextOfferOrder(),
                active: true
            }, true);
        });
    }

    var closeBtn = document.getElementById('offerModalClose');
    var cancelBtn = document.getElementById('cancelOfferBtn');
    function closeModal() {
        closeAdminModal(document.getElementById('offerModal'));
    }
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    var form = document.getElementById('offerForm');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            saveOffer();
        });
    }

    var fileInput = document.getElementById('offerImageFile');
    if (fileInput) {
        fileInput.addEventListener('change', function () {
            var file = fileInput.files && fileInput.files[0];
            if (!file) return;
            // Higher quality — offer posters have baked-in price/text that must stay sharp.
            fileToCompressedDataURL(file, 1600, 0.88).then(function (dataUrl) {
                var target = document.getElementById('offerImageURL');
                if (target) target.value = dataUrl;
                var preview = document.getElementById('offerImagePreview');
                if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
            }).catch(function (err) {
                alert((err && err.message) || 'Image error');
            });
        });
    }

    var urlInput = document.getElementById('offerImageURL');
    if (urlInput) {
        urlInput.addEventListener('input', function () {
            var preview = document.getElementById('offerImagePreview');
            if (!preview) return;
            var val = urlInput.value.trim();
            if (val) {
                preview.src = val;
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
            }
        });
    }
}

function openOfferModal(offerId, offer, isNew) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    document.getElementById('offerForm').reset();
    document.getElementById('offerId').value = offerId || '';
    document.getElementById('offerTitle').value = offer.title || '';
    document.getElementById('offerImageURL').value = offer.image || '';
    document.getElementById('offerLinkUrl').value = offer.linkUrl || '';
    document.getElementById('offerOrder').value = offer.order != null ? offer.order : nextOfferOrder();
    document.getElementById('offerActive').checked = offer.active !== false;
    var pr = document.getElementById('offerImagePreview');
    if (offer.image) {
        pr.src = offer.image;
        pr.style.display = 'block';
    } else {
        pr.style.display = 'none';
    }
    document.getElementById('offerModalTitle').textContent = isNew ? (S.addOffer || 'Add Offer') : (S.editOffer || 'Edit Offer');
    openAdminModal(document.getElementById('offerModal'));
}

function editOffer(offerId) {
    var cached = readCachedOffersAdmin().find(function (o) { return o.id === offerId; });
    if (cached) {
        openOfferModal(offerId, cached, false);
        return;
    }
    if (!window.db) return;
    getDoc(doc(db, 'menuOffers', offerId)).then(function (docSnap) {
        if (!snapExists(docSnap)) return;
        var d = docSnap.data() || {};
        openOfferModal(offerId, {
            title: d.title || '',
            image: d.image || '',
            linkUrl: d.linkUrl || '',
            order: d.order != null ? Number(d.order) : 0,
            active: d.active !== false
        }, false);
    });
}

function saveOffer() {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    var image = (document.getElementById('offerImageURL').value || '').trim();
    if (!image) {
        alert((S.offerImage || 'Offer image') + ' — required');
        return;
    }
    if (!window.db) {
        alert(S.itemSyncFailed + '\nFirebase not ready.');
        return;
    }
    if (!isAdminAuthenticated()) {
        alert(S.itemSyncFailed + '\nPlease log in again.');
        window.location.href = 'login.html';
        return;
    }

    var offerId = (document.getElementById('offerId').value || '').trim();
    var isCreate = !offerId;
    var title = (document.getElementById('offerTitle').value || '').trim();
    var linkUrl = (document.getElementById('offerLinkUrl').value || '').trim();
    var orderVal = parseInt(document.getElementById('offerOrder').value, 10);
    if (isNaN(orderVal)) orderVal = nextOfferOrder();
    var active = !!document.getElementById('offerActive').checked;

    var plainData = {
        image: image,
        title: title,
        linkUrl: linkUrl,
        order: orderVal,
        active: active,
        updated_at: new Date().toISOString()
    };

    var ref = isCreate ? doc(collection(db, 'menuOffers')) : doc(db, 'menuOffers', offerId);
    var savedId = ref.id;
    var writeData = Object.assign({}, plainData, {
        updated_at: serverTimestamp()
    });
    if (isCreate) {
        writeData.created_at = serverTimestamp();
        plainData.created_at = plainData.updated_at;
    }

    setDoc(ref, writeData, { merge: true }).then(function () {
        var list = readCachedOffersAdmin().filter(function (o) { return o.id !== savedId; });
        list.push(Object.assign({ id: savedId }, plainData));
        writeCachedOffersAdmin(list);
        closeAdminModal(document.getElementById('offerModal'));
        renderOffersTable(list);
        alert(S.offerSavedCloud || S.settingsSaved || 'Saved');
    }).catch(function (err) {
        alert((S.itemSyncFailed || 'Save failed') + (err && err.message ? '\n' + err.message : ''));
    });
}

function deleteOffer(offerId) {
    var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
    if (!confirm(S.deleteOfferConfirm || 'Delete this offer?')) return;
    if (!window.db) {
        alert(S.itemSyncFailed + '\nFirebase not ready.');
        return;
    }
    deleteDoc(doc(db, 'menuOffers', offerId)).then(function () {
        var list = readCachedOffersAdmin().filter(function (o) { return o.id !== offerId; });
        writeCachedOffersAdmin(list);
        renderOffersTable(list);
        alert(S.offerDeleted || 'Deleted');
    }).catch(function (err) {
        alert((S.itemSyncFailed || 'Delete failed') + (err && err.message ? '\n' + err.message : ''));
    });
}

function loadSettings() {
    var currentLang = localStorage.getItem('selectedLang') || 'ku';
    var S = i18n[currentLang] || i18n.en;
    var adminContent = document.getElementById('adminContent');
    if (!adminContent) return;

    var settingsLoadId = (window._settingsLoadId = (window._settingsLoadId || 0) + 1);

    var themeLabels = {
        ku: { title: 'ڕووکاری ڕەنگ', hint: 'ڕەنگێک هەڵبژێرە بۆ گۆڕینی ڕووکاری داشبۆرد', gold: 'زێڕین', emerald: 'زمروود', sapphire: 'یاقووتی شین', amethyst: 'بەنەوشەیی', ruby: 'یاقووت', sunset: 'خۆرئاوا', rose: 'گوڵی', graphite: 'خۆڵەمێشی', cyan: 'شینی ئاسمانی' },
        ar: { title: 'سمة الألوان', hint: 'اختر لوناً لتغيير مظهر لوحة التحكم بالكامل', gold: 'ذهبي', emerald: 'زمردي', sapphire: 'أزرق ياقوتي', amethyst: 'بنفسجي', ruby: 'ياقوتي', sunset: 'برتقالي', rose: 'وردي', graphite: 'رمادي', cyan: 'سماوي' },
        en: { title: 'Color Theme', hint: 'Pick a color to restyle the entire dashboard', gold: 'Gold', emerald: 'Emerald', sapphire: 'Sapphire', amethyst: 'Amethyst', ruby: 'Ruby', sunset: 'Sunset', rose: 'Rose', graphite: 'Graphite', cyan: 'Cyan' }
    };
    var TL = themeLabels[currentLang] || themeLabels.en;
    var themes = [
        { id: 'sapphire', color: '#3B82F6', dark: '#1D4ED8' },
        { id: 'gold', color: '#D4AF37', dark: '#B8910C' },
        { id: 'emerald', color: '#10B981', dark: '#047857' },
        { id: 'amethyst', color: '#8B5CF6', dark: '#6D28D9' },
        { id: 'ruby', color: '#F43F5E', dark: '#BE123C' },
        { id: 'sunset', color: '#F97316', dark: '#C2410C' },
        { id: 'rose', color: '#EC4899', dark: '#BE185D' },
        { id: 'cyan', color: '#06B6D4', dark: '#0E7490' },
        { id: 'graphite', color: '#94A3B8', dark: '#475569' }
    ];
    var currentAccent = localStorage.getItem('adminAccent') || 'sapphire';
    var swatchesHtml = themes.map(function (t) {
        var glow = 'rgba(0,0,0,0.25)';
        return '<button type="button" class="theme-swatch' + (t.id === currentAccent ? ' active' : '') + '" data-accent="' + t.id + '" ' +
               'style="--swatch:' + t.color + ';--swatch-dark:' + t.dark + ';--swatch-glow:' + glow + ';">' +
               '<span class="theme-swatch-check">✓</span>' +
               '<span class="theme-swatch-dot"></span>' +
               '<span class="theme-swatch-name">' + escapeHtmlText(TL[t.id] || t.id) + '</span>' +
               '</button>';
    }).join('');

    var openTimeStored = localStorage.getItem('cafeOpenTime') || '14:00';
    var closeTimeStored = localStorage.getItem('cafeCloseTime') || '02:00';
    var openTimeValue = typeof normalizeCafeTimeValue === 'function' ? normalizeCafeTimeValue(openTimeStored, '14:00') : openTimeStored;
    var closeTimeValue = typeof normalizeCafeTimeValue === 'function' ? normalizeCafeTimeValue(closeTimeStored, '02:00') : closeTimeStored;

    function settingsVal(key, fallback) {
        var raw = localStorage.getItem(key);
        if (raw == null || String(raw).trim() === '') raw = fallback == null ? '' : fallback;
        if (key === 'cafeName' && typeof normalizeCafeBrandName === 'function') {
            raw = normalizeCafeBrandName(raw);
        }
        return escapeHtmlAttr(raw);
    }

    adminContent.innerHTML =
        '<div class="card settings-contact-card">' +
            '<h2>' + escapeHtmlText(S.settings) + '</h2>' +
            '<div class="settings-social-field settings-multilang-field">' +
                '<span class="settings-social-icon settings-social-icon--cafe" aria-hidden="true"><i class="fa-solid fa-mug-hot"></i></span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label class="settings-field-title">' + escapeHtmlText(S.cafeName || 'ناوی کافێ') + '</label>' +
                    '<div class="settings-multilang-grid">' +
                        '<div class="settings-lang-input-item">' +
                            '<span class="settings-lang-tag tag-ku">کوردی</span>' +
                            '<input type="text" id="cafeNameKu" value="' + settingsVal('cafeNameKu', 'بریو کافێ') + '" placeholder="بریو کافێ" dir="rtl">' +
                        '</div>' +
                        '<div class="settings-lang-input-item">' +
                            '<span class="settings-lang-tag tag-ar">عربي</span>' +
                            '<input type="text" id="cafeNameAr" value="' + settingsVal('cafeNameAr', 'بریو کوفي') + '" placeholder="بریو کوفي" dir="rtl">' +
                        '</div>' +
                        '<div class="settings-lang-input-item">' +
                            '<span class="settings-lang-tag tag-en">English</span>' +
                            '<input type="text" id="cafeNameEn" value="' + settingsVal('cafeNameEn', 'BREW CAFE & REST') + '" placeholder="BREW CAFE & REST" dir="ltr">' +
                        '</div>' +
                    '</div>' +
                    '<input type="hidden" id="cafeName" value="' + settingsVal('cafeName', 'BREW CAFE & REST') + '">' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field">' +
                '<span class="settings-social-icon settings-social-icon--contact" aria-hidden="true">' +
                    '<i class="fa-solid fa-phone"></i>' +
                    '<i class="fa-brands fa-whatsapp"></i>' +
                '</span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label for="whatsappPhone">' + escapeHtmlText(S.callWhatsAppNumber) + '</label>' +
                    '<input type="tel" id="whatsappPhone" value="' + settingsVal('whatsappPhone', '9647506454656') + '" placeholder="' + escapeHtmlAttr(S.phonePlaceholder) + '">' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field">' +
                '<span class="settings-social-icon settings-social-icon--maps" aria-hidden="true"><i class="fa-solid fa-map-location-dot"></i></span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label for="cafeLocationUrl">' + escapeHtmlText(S.locationMapsUrl) + '</label>' +
                    '<input type="url" id="cafeLocationUrl" value="' + settingsVal('cafeLocationUrl', 'https://maps.app.goo.gl/mmi5iv7mnGKxKZoq9?g_st=ic') + '" placeholder="https://maps.google.com/...">' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field settings-multilang-field">' +
                '<span class="settings-social-icon settings-social-icon--pin" aria-hidden="true"><i class="fa-solid fa-location-dot"></i></span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label class="settings-field-title">' + escapeHtmlText(S.locationLabelField || 'ناونیشان (دەردەکەوێت لە مێنوو)') + '</label>' +
                    '<div class="settings-multilang-grid">' +
                        '<div class="settings-lang-input-item">' +
                            '<span class="settings-lang-tag tag-ku">کوردی</span>' +
                            '<input type="text" id="cafeLocationLabelKu" value="' + settingsVal('cafeLocationLabelKu', 'بەحرکە-مجەمع') + '" placeholder="بەحرکە-مجەمع" dir="rtl">' +
                        '</div>' +
                        '<div class="settings-lang-input-item">' +
                            '<span class="settings-lang-tag tag-ar">عربي</span>' +
                            '<input type="text" id="cafeLocationLabelAr" value="' + settingsVal('cafeLocationLabelAr', 'بحركة-المجمع') + '" placeholder="بحركة-المجمع" dir="rtl">' +
                        '</div>' +
                        '<div class="settings-lang-input-item">' +
                            '<span class="settings-lang-tag tag-en">English</span>' +
                            '<input type="text" id="cafeLocationLabelEn" value="' + settingsVal('cafeLocationLabelEn', 'Baharka - Complex') + '" placeholder="Baharka - Complex" dir="ltr">' +
                        '</div>' +
                    '</div>' +
                    '<input type="hidden" id="cafeLocationLabel" value="' + settingsVal('cafeLocationLabel', 'بەحرکە-مجەمع') + '">' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field">' +
                '<span class="settings-social-icon settings-social-icon--currency" aria-hidden="true">' +
                    '<i class="fa-solid fa-coins"></i>' +
                '</span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label for="cafeCurrency">' + escapeHtmlText(S.currency) + '</label>' +
                    '<input type="text" id="cafeCurrency" value="IQD" readonly>' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field settings-hours-field">' +
                '<span class="settings-social-icon settings-social-icon--hours" aria-hidden="true"><i class="fa-regular fa-clock"></i></span>' +
                '<div class="settings-social-input-wrap settings-hours-block">' +
                    '<div class="settings-hours-row">' +
                        '<div class="settings-hours-input">' +
                            '<label for="cafeOpenTimeBtn">' + escapeHtmlText(S.cafeOpenTimeLabel) + '</label>' +
                            buildCafeTimePickerMarkup('cafeOpen', openTimeValue, '14:00', S, currentLang) +
                        '</div>' +
                        '<div class="settings-hours-input">' +
                            '<label for="cafeCloseTimeBtn">' + escapeHtmlText(S.cafeCloseTimeLabel) + '</label>' +
                            buildCafeTimePickerMarkup('cafeClose', closeTimeValue, '02:00', S, currentLang) +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div class="card settings-social-card" style="margin-top:20px;">' +
            '<div class="settings-section-label"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i> ' + escapeHtmlText(S.socialLinks) + '</div>' +
            '<div class="settings-section-hint">' + escapeHtmlText(S.socialLinksHint) + '</div>' +
            '<div class="settings-social-field">' +
                '<span class="settings-social-icon settings-social-icon--instagram" aria-hidden="true"><i class="fa-brands fa-instagram"></i></span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label for="cafeInstagram">' + escapeHtmlText(S.instagramUrl) + '</label>' +
                    '<input type="url" id="cafeInstagram" value="' + settingsVal('cafeInstagram', '') + '" placeholder="https://instagram.com/...">' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field">' +
                '<span class="settings-social-icon settings-social-icon--tiktok" aria-hidden="true"><i class="fa-brands fa-tiktok"></i></span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label for="cafeTiktok">' + escapeHtmlText(S.tiktokUrl) + '</label>' +
                    '<input type="url" id="cafeTiktok" value="' + settingsVal('cafeTiktok', '') + '" placeholder="https://tiktok.com/@...">' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field">' +
                '<span class="settings-social-icon settings-social-icon--snapchat" aria-hidden="true"><i class="fa-brands fa-snapchat"></i></span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label for="cafeSnapchat">' + escapeHtmlText(S.snapchatUrl) + '</label>' +
                    '<input type="url" id="cafeSnapchat" value="' + settingsVal('cafeSnapchat', '') + '" placeholder="https://snapchat.com/add/...">' +
                '</div>' +
            '</div>' +
            '<div class="settings-social-field">' +
                '<span class="settings-social-icon settings-social-icon--facebook" aria-hidden="true"><i class="fa-brands fa-facebook-f"></i></span>' +
                '<div class="settings-social-input-wrap">' +
                    '<label for="cafeFacebook">' + escapeHtmlText(S.facebookUrl) + '</label>' +
                    '<input type="url" id="cafeFacebook" value="' + settingsVal('cafeFacebook', '') + '" placeholder="https://facebook.com/...">' +
                '</div>' +
            '</div>' +
            '<button type="button" class="btn-primary" id="saveSettingsBtn" style="margin-top:8px;">' + escapeHtmlText(S.saveSettings) + '</button>' +
        '</div>' +
        '<div class="card" style="margin-top:20px;">' +
            '<div class="settings-section-label">🎨 ' + escapeHtmlText(TL.title) + '</div>' +
            '<div class="settings-section-hint">' + escapeHtmlText(TL.hint) + '</div>' +
            '<div class="theme-picker" id="themePicker">' + swatchesHtml + '</div>' +
        '</div>';

    setupCafeTimePickers(currentLang);

    function markSettingsDirty(e) {
        var el = e && e.target;
        if (el && el.tagName === 'INPUT') el.setAttribute('data-dirty', '1');
    }
    adminContent.addEventListener('input', markSettingsDirty);
    adminContent.addEventListener('change', markSettingsDirty);

    var themePicker = document.getElementById('themePicker');
    if (themePicker) {
        themePicker.addEventListener('click', function (e) {
            var btn = e.target.closest('.theme-swatch');
            if (!btn) return;
            var accent = btn.getAttribute('data-accent');
            applyAdminAccent(accent);
            themePicker.querySelectorAll('.theme-swatch').forEach(function (s) {
                s.classList.toggle('active', s === btn);
            });
        });
    }

    function readInputValue(id) {
        var el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
    }

    function setInputValue(id, value) {
        var el = document.getElementById(id);
        if (el) el.value = value == null ? '' : String(value);
    }

    var saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            try {
                var cafeNameKu = readInputValue('cafeNameKu');
                var cafeNameAr = readInputValue('cafeNameAr');
                var cafeNameEn = readInputValue('cafeNameEn');
                var cafeName = cafeNameEn || cafeNameKu || cafeNameAr || 'BREW CAFE & REST';

                var cafeLocationLabelKu = readInputValue('cafeLocationLabelKu');
                var cafeLocationLabelAr = readInputValue('cafeLocationLabelAr');
                var cafeLocationLabelEn = readInputValue('cafeLocationLabelEn');
                var cafeLocationLabel = cafeLocationLabelKu || cafeLocationLabelAr || cafeLocationLabelEn || 'بەحرکە-مجەمع';

                var whatsappPhone = typeof normalizeWhatsAppPhone === 'function'
                    ? normalizeWhatsAppPhone(readInputValue('whatsappPhone'))
                    : readInputValue('whatsappPhone');
                var cafeLocationUrl = readInputValue('cafeLocationUrl');
                var cafeInstagram = typeof normalizeSocialUrl === 'function'
                    ? normalizeSocialUrl(readInputValue('cafeInstagram'), 'instagram')
                    : readInputValue('cafeInstagram');
                var cafeTiktok = typeof normalizeSocialUrl === 'function'
                    ? normalizeSocialUrl(readInputValue('cafeTiktok'), 'tiktok')
                    : readInputValue('cafeTiktok');
                var cafeSnapchat = typeof normalizeSocialUrl === 'function'
                    ? normalizeSocialUrl(readInputValue('cafeSnapchat'), 'snapchat')
                    : readInputValue('cafeSnapchat');
                var cafeFacebook = typeof normalizeSocialUrl === 'function'
                    ? normalizeSocialUrl(readInputValue('cafeFacebook'), 'facebook')
                    : readInputValue('cafeFacebook');
                var cafeOpenTime = readInputValue('cafeOpenTime') || '14:00';
                var cafeCloseTime = readInputValue('cafeCloseTime') || '02:00';
                if (typeof normalizeCafeTimeValue === 'function') {
                    cafeOpenTime = normalizeCafeTimeValue(cafeOpenTime, '14:00');
                    cafeCloseTime = normalizeCafeTimeValue(cafeCloseTime, '02:00');
                }

                function storeSetting(key, value) {
                    if (value == null || String(value).trim() === '') {
                        localStorage.removeItem(key);
                    } else {
                        localStorage.setItem(key, String(value).trim());
                    }
                }

                storeSetting('cafeName', cafeName);
                storeSetting('cafeNameKu', cafeNameKu);
                storeSetting('cafeNameAr', cafeNameAr);
                storeSetting('cafeNameEn', cafeNameEn);
                storeSetting('cafeLocationLabel', cafeLocationLabel);
                storeSetting('cafeLocationLabelKu', cafeLocationLabelKu);
                storeSetting('cafeLocationLabelAr', cafeLocationLabelAr);
                storeSetting('cafeLocationLabelEn', cafeLocationLabelEn);
                storeSetting('whatsappPhone', whatsappPhone);
                storeSetting('cafeLocationUrl', cafeLocationUrl);
                storeSetting('cafeInstagram', cafeInstagram);
                storeSetting('cafeTiktok', cafeTiktok);
                storeSetting('cafeSnapchat', cafeSnapchat);
                storeSetting('cafeFacebook', cafeFacebook);
                storeSetting('cafeOpenTime', cafeOpenTime);
                storeSetting('cafeCloseTime', cafeCloseTime);
                try { localStorage.removeItem('menuExpireDate'); } catch (e) {}
                var clientUpdatedAt = Date.now();
                try {
                    localStorage.setItem('cafeSettingsUpdatedAt', String(clientUpdatedAt));
                } catch (e) {}

                setInputValue('cafeName', cafeName);
                setInputValue('cafeNameKu', cafeNameKu);
                setInputValue('cafeNameAr', cafeNameAr);
                setInputValue('cafeNameEn', cafeNameEn);
                setInputValue('cafeLocationLabel', cafeLocationLabel);
                setInputValue('cafeLocationLabelKu', cafeLocationLabelKu);
                setInputValue('cafeLocationLabelAr', cafeLocationLabelAr);
                setInputValue('cafeLocationLabelEn', cafeLocationLabelEn);
                setInputValue('whatsappPhone', whatsappPhone);
                setInputValue('cafeLocationUrl', cafeLocationUrl);
                setInputValue('cafeInstagram', cafeInstagram);
                setInputValue('cafeTiktok', cafeTiktok);
                setInputValue('cafeSnapchat', cafeSnapchat);
                setInputValue('cafeFacebook', cafeFacebook);
                setInputValue('cafeOpenTime', cafeOpenTime);
                setInputValue('cafeCloseTime', cafeCloseTime);

                ['cafeName', 'cafeNameKu', 'cafeNameAr', 'cafeNameEn', 'whatsappPhone', 'cafeLocationUrl', 'cafeLocationLabel', 'cafeLocationLabelKu', 'cafeLocationLabelAr', 'cafeLocationLabelEn', 'cafeInstagram', 'cafeTiktok', 'cafeSnapchat', 'cafeFacebook', 'cafeOpenTime', 'cafeCloseTime'].forEach(function (id) {
                    var input = document.getElementById(id);
                    if (input) input.removeAttribute('data-dirty');
                });

                var settingsPayload = {
                    cafeName: cafeName,
                    cafeNameKu: cafeNameKu,
                    cafeNameAr: cafeNameAr,
                    cafeNameEn: cafeNameEn,
                    cafeLocationLabel: cafeLocationLabel,
                    cafeLocationLabelKu: cafeLocationLabelKu,
                    cafeLocationLabelAr: cafeLocationLabelAr,
                    cafeLocationLabelEn: cafeLocationLabelEn,
                    whatsappPhone: whatsappPhone,
                    cafeLocationUrl: cafeLocationUrl,
                    cafeInstagram: cafeInstagram,
                    cafeTiktok: cafeTiktok,
                    cafeSnapchat: cafeSnapchat,
                    cafeFacebook: cafeFacebook,
                    cafeOpenTime: cafeOpenTime,
                    cafeCloseTime: cafeCloseTime,
                    clientUpdatedAt: clientUpdatedAt
                };

                if (typeof saveCafeSettingsToFirestore === 'function') {
                    saveCafeSettingsToFirestore(settingsPayload, function (err) {
                        if (err) {
                            var msg = (err && err.message ? String(err.message) : String(err)).toLowerCase();
                            if (msg.indexOf('permission') !== -1 || msg.indexOf('insufficient') !== -1 || msg.indexOf('denied') !== -1) {
                                alert('⚠️ Settings saved locally only.\n\nFirestore WRITE was DENIED. Fix:\n1) In Firebase Console → project brew-coffee-1cd84 → Firestore → Rules tab, paste the rules and click PUBLISH.\n2) Make sure you are logged in as admin.\n\n(' + (err && err.message ? err.message : err) + ')');
                            } else {
                                alert('⚠️ ' + S.settingsSaved + '\n\nCloud sync failed: ' + (err && err.message ? err.message : err) + '\n\nChanges saved locally only.');
                            }
                        } else {
                            alert(S.settingsSaved);
                        }
                        // Refresh cafe info UI if menu panel helpers exist in this session.
                        if (typeof updateCafeInfoPanel === 'function') {
                            try { updateCafeInfoPanel(); } catch (e) { /* ignore */ }
                        }
                    });
                } else {
                    alert(S.settingsSaved);
                }
            } catch (err) {
                console.error('saveSettings error:', err);
                alert((S.errorPrefix || 'Error:') + ' ' + (err && err.message ? err.message : err));
            }
        });
    }

    if (typeof loadCafeSettingsFromFirestore === 'function') {
        loadCafeSettingsFromFirestore(function () {
            if (settingsLoadId !== window._settingsLoadId) return;
            if (!document.getElementById('saveSettingsBtn')) return;

            var fields = {
                cafeName: 'cafeName',
                cafeNameKu: 'cafeNameKu',
                cafeNameAr: 'cafeNameAr',
                cafeNameEn: 'cafeNameEn',
                whatsappPhone: 'whatsappPhone',
                cafeLocationUrl: 'cafeLocationUrl',
                cafeLocationLabel: 'cafeLocationLabel',
                cafeLocationLabelKu: 'cafeLocationLabelKu',
                cafeLocationLabelAr: 'cafeLocationLabelAr',
                cafeLocationLabelEn: 'cafeLocationLabelEn',
                cafeInstagram: 'cafeInstagram',
                cafeTiktok: 'cafeTiktok',
                cafeSnapchat: 'cafeSnapchat',
                cafeFacebook: 'cafeFacebook'
            };
            Object.keys(fields).forEach(function (storageKey) {
                var input = document.getElementById(fields[storageKey]);
                if (!input) return;
                if (input.getAttribute('data-dirty') === '1') return;
                if (document.activeElement === input) return;
                var value = localStorage.getItem(storageKey);
                if (value == null) value = '';
                value = String(value).trim();
                if (storageKey === 'whatsappPhone' && typeof normalizeWhatsAppPhone === 'function') {
                    value = normalizeWhatsAppPhone(value || '');
                }
                // Always refresh — including cleared social links.
                input.value = value;
            });
            var openLoaded = document.getElementById('cafeOpenTime');
            var closeLoaded = document.getElementById('cafeCloseTime');
            if (openLoaded && openLoaded.getAttribute('data-dirty') !== '1' && document.activeElement !== openLoaded) {
                openLoaded.value = (typeof normalizeCafeTimeValue === 'function'
                    ? normalizeCafeTimeValue(localStorage.getItem('cafeOpenTime') || '14:00', '14:00')
                    : (localStorage.getItem('cafeOpenTime') || '14:00'));
                if (typeof syncCafeTimePickerFromStorage === 'function') {
                    syncCafeTimePickerFromStorage('cafeOpen', currentLang);
                }
            }
            if (closeLoaded && closeLoaded.getAttribute('data-dirty') !== '1' && document.activeElement !== closeLoaded) {
                closeLoaded.value = (typeof normalizeCafeTimeValue === 'function'
                    ? normalizeCafeTimeValue(localStorage.getItem('cafeCloseTime') || '02:00', '02:00')
                    : (localStorage.getItem('cafeCloseTime') || '02:00'));
                if (typeof syncCafeTimePickerFromStorage === 'function') {
                    syncCafeTimePickerFromStorage('cafeClose', currentLang);
                }
            }
        });
    }
}


 /* ============ EXPENSES ============ */

 function readCachedExpenses() {
     try {
         return JSON.parse(localStorage.getItem('cachedExpenses') || '[]').map(normalizeExpenseEntry);
     } catch (e) {
         return [];
     }
 }

  function writeCachedExpenses(items) {
      safeSetItem('cachedExpenses', JSON.stringify(items));
      syncExpensesLiveFromCache();
  }

 function expenseTimestampToMs(item) {
     if (!item) return 0;
     var sec = deriveExpenseTimestampSeconds(item);
     if (sec != null) return sec * 1000;
     return 0;
 }

 function expenseEntryFromDoc(doc) {
     var exp = doc.data();
     var ts = exp.timestamp;
     var timestampSeconds = null;
     if (ts && ts.seconds != null) timestampSeconds = ts.seconds;
     else if (ts && ts._seconds != null) timestampSeconds = ts._seconds;
     else if (ts && typeof ts.toDate === 'function') timestampSeconds = Math.floor(ts.toDate().getTime() / 1000);
     return normalizeExpenseEntry({
         id: doc.id,
         name: exp.name,
         price: exp.price || 0,
         date: exp.date,
         time: exp.time,
         timestamp: ts,
         timestampSeconds: timestampSeconds
     });
 }

 function getExpenseMonthRange(month) {
     var year = new Date().getFullYear();
     return {
         start: new Date(year, month, 1),
         end: new Date(year, month + 1, 1)
     };
 }

 function filterExpensesByMonth(items, month) {
     var year = new Date().getFullYear();
     return items.filter(function (item) {
         return isExpenseInMonth(item, month, year);
     }).sort(function (a, b) {
         return expenseTimestampToMs(b) - expenseTimestampToMs(a);
     });
 }

 function filterExpensesByDay(items, dayStart) {
     return items.filter(function (item) {
         return isExpenseOnLocalDay(item, dayStart);
     }).sort(function (a, b) {
         return expenseTimestampToMs(b) - expenseTimestampToMs(a);
     });
 }

 function upsertCachedExpense(entry) {
     normalizeExpenseEntry(entry);
     var items = readCachedExpenses();
     var idx = -1;
     for (var i = 0; i < items.length; i++) {
         if (items[i].id === entry.id) { idx = i; break; }
     }
     if (idx >= 0) items[idx] = entry;
     else items.push(entry);
     writeCachedExpenses(items);
 }

 function removeCachedExpense(id) {
     writeCachedExpenses(readCachedExpenses().filter(function (e) { return e.id !== id; }));
 }

 function mergeExpensesSnapIntoCache(snap) {
     if (!snap || snap.empty) return;
     var all = readCachedExpenses();
     snap.forEach(function (doc) {
         var entry = expenseEntryFromDoc(doc);
         var found = false;
         for (var i = 0; i < all.length; i++) {
             if (all[i].id === entry.id) { all[i] = entry; found = true; break; }
         }
         if (!found) all.push(entry);
     });
     writeCachedExpenses(all);
 }

 function paintExpensesStatsFromCache(month) {
     if (month === undefined || month === null) month = new Date().getMonth();
     var year = new Date().getFullYear();
     var today = new Date();
     today.setHours(0, 0, 0, 0);
     var tomorrow = new Date(today);
     tomorrow.setDate(tomorrow.getDate() + 1);
     var mStart = new Date(year, month, 1);
     var mEnd = new Date(year, month + 1, 1);

     var todayTotal = sumExpensesInRange(today, tomorrow);
     var monthItems = filterExpensesByMonth(readCachedExpenses(), month);
     var monthTotal = 0;
     monthItems.forEach(function (e) { monthTotal += e.price || 0; });

     var el = document.getElementById('expTodayTotal');
     if (el) el.textContent = todayTotal.toLocaleString() + ' IQD';
     var elM = document.getElementById('expMonthTotal');
     if (elM) elM.textContent = monthTotal.toLocaleString() + ' IQD';
     var elC = document.getElementById('expCount');
     if (elC) elC.textContent = monthItems.length.toString();
 }

 function renderExpensesList(month, items) {
     var list = document.getElementById('expensesList');
     if (!list) return;
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;

     if (!items || items.length === 0) {
         list.innerHTML = '<div class="expenses-empty">' +
             '<div class="expenses-empty-icon">📭</div>' +
             '<p>' + S.noExpenses + '</p>' +
         '</div>';
         return;
     }

     var now = new Date();
     var isCurrentMonth = month === now.getMonth() && now.getFullYear() === new Date().getFullYear();
     var todayStart = new Date();
     todayStart.setHours(0, 0, 0, 0);
     var todayItems = isCurrentMonth ? filterExpensesByDay(items, todayStart) : [];
     var todayIds = {};
     todayItems.forEach(function (e) { todayIds[e.id] = true; });
     var monthRest = isCurrentMonth ? items.filter(function (e) { return !todayIds[e.id]; }) : items;

     function buildRows(listItems) {
         var total = 0;
         var rows = '';
         listItems.forEach(function (item) {
             total += (item.price || 0);
             var ms = expenseTimestampToMs(item);
             var dateObj = ms ? new Date(ms) : null;
             var dateStr = dateObj ? dateObj.toLocaleDateString('ku-IQ') : (item.date || '—');
             var timeStr = dateObj ? dateObj.toLocaleTimeString('ku-IQ', { hour: '2-digit', minute: '2-digit' }) : (item.time || '');
             rows += '<tr class="expense-row">' +
                 '<td class="expense-cell expense-cell--name"><span class="expense-name">' + (item.name || '—') + '</span></td>' +
                 '<td class="expense-cell expense-cell--price"><span class="expense-price">' + (item.price || 0).toLocaleString() + ' IQD</span></td>' +
                 '<td class="expense-cell expense-cell--date"><span class="expense-date">' + dateStr + '</span><span class="expense-time">' + timeStr + '</span></td>' +
                 '<td class="expense-cell expense-cell--actions">' +
                     '<button type="button" class="btn-primary btn-sm edit-expense" data-id="' + item.id + '" title="' + S.edit + '">✎</button> ' +
                     '<button type="button" class="btn-danger btn-sm delete-expense" data-id="' + item.id + '">✕</button>' +
                 '</td>' +
             '</tr>';
         });
         return { rows: rows, total: total };
     }

     function buildTable(title, listItems) {
         if (!listItems.length) return '';
         var built = buildRows(listItems);
         return (title ? '<h3 class="expenses-day-heading">' + title + '</h3>' : '') +
             '<div class="expenses-table-wrapper">' +
             '<table class="expenses-table">' +
                 '<thead><tr>' +
                     '<th>' + S.expenseName + '</th>' +
                     '<th>' + S.expensePrice + '</th>' +
                     '<th>' + S.expenseDate + '</th>' +
                     '<th></th>' +
                 '</tr></thead>' +
                 '<tbody>' + built.rows + '</tbody>' +
                 '<tfoot><tr>' +
                     '<td colspan="4" class="expense-total-cell">' +
                         '<span class="expense-total-label">' + S.totalExpenses + ':</span>' +
                         '<span class="expense-total-value">' + built.total.toLocaleString() + ' IQD</span>' +
                     '</td>' +
                 '</tr></tfoot>' +
             '</table></div>';
     }

     var html = '';
     if (todayItems.length) {
         html += buildTable(S.todayExpenses, todayItems);
     }
     if (monthRest.length) {
         html += buildTable(todayItems.length ? (S.monthlyExpenses || S.expenses) : '', monthRest);
     }
     if (!html) {
         list.innerHTML = '<div class="expenses-empty">' +
             '<div class="expenses-empty-icon">📭</div>' +
             '<p>' + S.noExpenses + '</p>' +
         '</div>';
         return;
     }

     list.innerHTML = html;

     list.querySelectorAll('.edit-expense').forEach(function (btn) {
         btn.addEventListener('click', function () {
             editExpense(this.getAttribute('data-id'));
         });
     });
     list.querySelectorAll('.delete-expense').forEach(function (btn) {
         btn.addEventListener('click', function () {
             deleteExpense(this.getAttribute('data-id'));
         });
     });
 }

 function loadExpenses() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     var adminContent = document.getElementById('adminContent');
     var now = new Date();
     var currentMonth = now.getMonth();
     var monthsHtml = '';
     var mNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
     for (var m = 0; m < 12; m++) {
         monthsHtml += '<option value="' + m + '"' + (m === currentMonth ? ' selected' : '') + '>' + (m + 1) + ' — ' + S[mNames[m]] + ' ' + now.getFullYear() + '</option>';
     }

     adminContent.innerHTML =
         '<div class="expenses-page">' +
             '<div class="expenses-header">' +
                 '<div class="expenses-header-title">' +
                     '<h2>📉 ' + S.expenses + '</h2>' +
                 '</div>' +
                 '<div class="expenses-header-actions">' +
                     '<div class="month-selector">' +
                         '<select id="expensesMonthSelect">' + monthsHtml + '</select>' +
                     '</div>' +
                     '<button class="btn-primary" id="addExpenseBtn">+ ' + S.addExpense + '</button>' +
                 '</div>' +
             '</div>' +
             '<div class="expenses-stats">' +
                 '<div class="expense-stat-card expense-stat--today">' +
                     '<div class="expense-stat-icon">📅</div>' +
                     '<div class="expense-stat-info">' +
                         '<span class="expense-stat-label">' + S.todayExpenses + '</span>' +
                         '<span class="expense-stat-value" id="expTodayTotal">0 IQD</span>' +
                     '</div>' +
                 '</div>' +
                 '<div class="expense-stat-card expense-stat--month">' +
                     '<div class="expense-stat-icon">📊</div>' +
                     '<div class="expense-stat-info">' +
                         '<span class="expense-stat-label">' + S.monthlyExpenses + '</span>' +
                         '<span class="expense-stat-value" id="expMonthTotal">0 IQD</span>' +
                     '</div>' +
                 '</div>' +
                 '<div class="expense-stat-card expense-stat--count">' +
                     '<div class="expense-stat-icon">📋</div>' +
                     '<div class="expense-stat-info">' +
                         '<span class="expense-stat-label">' + S.total + '</span>' +
                         '<span class="expense-stat-value" id="expCount">0</span>' +
                     '</div>' +
                 '</div>' +
             '</div>' +
             '<div class="expenses-table-container">' +
                 '<div id="expensesList"></div>' +
             '</div>' +
         '</div>' +
         '<div id="expenseModal" class="modal-overlay">' +
             '<div class="modal expense-modal">' +
                 '<div class="modal-content">' +
                     '<button class="modal-close" id="expenseModalClose" aria-label="Close">' +
                         '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
                     '</button>' +
                     '<h2 id="expenseModalTitle">' + S.addExpense + '</h2>' +
                     '<form id="expenseForm" novalidate>' +
                         '<div class="form-group">' +
                             '<label>' + S.expenseName + '</label>' +
                             '<input type="text" id="expenseName" list="expenseSuggestions" autocomplete="off">' +
                             '<datalist id="expenseSuggestions">' +
                                 '<option value="' + S.water + '">' +
                                 '<option value="' + S.milk + '">' +
                                 '<option value="' + S.coffee + '">' +
                                 '<option value="' + S.electric + '">' +
                                 '<option value="' + S.gas + '">' +
                                 '<option value="' + S.rent + '">' +
                                 '<option value="' + S.salary + '">' +
                                 '<option value="' + S.other + '">' +
                             '</datalist>' +
                         '</div>' +
                         '<div class="form-row">' +
                             '<div class="form-group">' +
                                 '<label>' + S.expensePrice + '</label>' +
                                 '<input type="text" inputmode="decimal" id="expensePrice" min="0" autocomplete="off">' +
                             '</div>' +
                             '<div class="form-group">' +
                                 '<label>' + S.expenseDate + '</label>' +
                                 '<input type="date" id="expenseDate">' +
                             '</div>' +
                         '</div>' +
                         '<div class="form-group">' +
                             '<label>' + S.expenseTime + '</label>' +
                             '<input type="time" id="expenseTime">' +
                         '</div>' +
                         '<button type="button" class="btn-primary" id="saveExpenseBtn">' + S.saveItem + '</button>' +
                         '<button type="button" class="btn-secondary" id="cancelExpenseBtn" style="margin-left:8px;">' + S.cancel + '</button>' +
                         '<input type="hidden" id="expenseId" value="">' +
                     '</form>' +
                 '</div>' +
             '</div>' +
         '</div>';

     var monthSelect = document.getElementById('expensesMonthSelect');
     if (monthSelect) {
         monthSelect.addEventListener('change', function () {
             renderExpensesUI(parseInt(this.value, 10));
         });
     }

     var addBtn = document.getElementById('addExpenseBtn');
     if (addBtn) {
         addBtn.addEventListener('click', function () {
             document.getElementById('expenseModalTitle').textContent = S.addExpense;
             document.getElementById('expenseForm').reset();
             document.getElementById('expenseId').value = '';
             var today = getLocalDateKey(new Date());
             var now = new Date().toTimeString().slice(0, 5);
             document.getElementById('expenseDate').value = today;
             document.getElementById('expenseTime').value = now;
             document.getElementById('expenseModal').classList.add('active');
         });
     }

     var closeBtn = document.getElementById('expenseModalClose');
     if (closeBtn) {
         closeBtn.addEventListener('click', function () {
             document.getElementById('expenseModal').classList.remove('active');
         });
     }

     var cancelBtn = document.getElementById('cancelExpenseBtn');
     if (cancelBtn) {
         cancelBtn.addEventListener('click', function () {
             document.getElementById('expenseModal').classList.remove('active');
         });
     }

     var form = document.getElementById('expenseForm');
     function triggerSaveExpense() {
         try { saveExpense(); } catch (err) {
             console.error('saveExpense error:', err);
             alert(S.itemSyncFailed + (err && err.message ? '\n' + err.message : ''));
         }
     }
     if (form) {
         form.addEventListener('submit', function (e) {
             e.preventDefault();
             triggerSaveExpense();
         });
     }
     var saveExpenseBtn = document.getElementById('saveExpenseBtn');
     if (saveExpenseBtn) {
         saveExpenseBtn.addEventListener('click', function (e) {
             e.preventDefault();
             triggerSaveExpense();
         });
     }

     renderExpensesUI(currentMonth);
     startAdminLiveListeners();
 }

 function renderExpensesUI(month) {
     if (month === undefined || month === null) month = new Date().getMonth();
     var year = new Date().getFullYear();
     var today = new Date();
     today.setHours(0, 0, 0, 0);
     var tomorrow = new Date(today);
     tomorrow.setDate(tomorrow.getDate() + 1);
     var mStart = new Date(year, month, 1);
     var mEnd = new Date(year, month + 1, 1);
     var todayMs = today.getTime();
     var tomorrowMs = tomorrow.getTime();
     var startMs = mStart.getTime();
     var endMs = mEnd.getTime();

     var all = readCachedExpenses();
     var monthItems = filterExpensesByMonth(all, month);
     var todayTotal = 0;
     var monthTotal = 0;
     all.forEach(function (e) {
         if (isExpenseOnLocalDay(e, today)) todayTotal += e.price || 0;
         if (isExpenseInMonth(e, month, year)) monthTotal += e.price || 0;
     });

     var el = document.getElementById('expTodayTotal');
     if (el) el.textContent = todayTotal.toLocaleString() + ' IQD';
     var elM = document.getElementById('expMonthTotal');
     if (elM) elM.textContent = monthTotal.toLocaleString() + ' IQD';
     var elC = document.getElementById('expCount');
     if (elC) elC.textContent = monthItems.length.toString();

     renderExpensesList(month, monthItems);
 }

 function loadExpensesStats(month) {
     renderExpensesUI(month);
 }

 function loadExpensesList(month) {
     renderExpensesUI(month);
 }

 function editExpense(expenseId) {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     var expense = readCachedExpenses().filter(function (e) { return e.id === expenseId; })[0];
     if (!expense) return;

     document.getElementById('expenseModalTitle').textContent = S.editExpense || S.editItem;
     document.getElementById('expenseId').value = expense.id;
     document.getElementById('expenseName').value = expense.name || '';
     document.getElementById('expensePrice').value = expense.price != null ? expense.price : '';

     var dateVal = expense.date || '';
     var timeVal = expense.time || '';
     if (!dateVal || !timeVal) {
         var ms = expenseTimestampToMs(expense);
         if (ms) {
             var d = new Date(ms);
             dateVal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
             timeVal = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
         }
     }
     document.getElementById('expenseDate').value = dateVal;
     document.getElementById('expenseTime').value = timeVal;
     document.getElementById('expenseModal').classList.add('active');
 }

 function saveExpense() {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     var name = document.getElementById('expenseName').value.trim();
     var price = document.getElementById('expensePrice').value.trim();
     var date = document.getElementById('expenseDate').value;
     var time = document.getElementById('expenseTime').value;

     if (!name || !price || !date || !time) {
         alert(S.fillAll);
         return;
     }

     var expenseId = document.getElementById('expenseId').value;
     var dateTime = new Date(date + 'T' + time);
     if (isNaN(dateTime.getTime())) {
         alert(S.fillAll);
         return;
     }

     var expenseMonth = dateTime.getMonth();
     var monthSelect = document.getElementById('expensesMonthSelect');
     if (monthSelect) monthSelect.value = String(expenseMonth);

     var tempId = expenseId || ('local-' + Date.now());
     var cacheEntry = {
         id: tempId,
         name: name,
         price: parseFloat(price) || 0,
         date: date,
         time: time,
         timestampSeconds: Math.floor(dateTime.getTime() / 1000)
     };
     upsertCachedExpense(cacheEntry);
     syncExpensesLiveFromCache();

     document.getElementById('expenseModal').classList.remove('active');
     renderExpensesUI(expenseMonth);
     if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());

     if (!window.db) {
         alert(S.expenseSavedOffline || S.expenseSaved);
         return;
     }

     var expenseData = {
         name: name,
         price: parseFloat(price) || 0,
         date: date,
         time: time,
         timestamp: Timestamp.fromDate(dateTime),
         updated_at: serverTimestamp()
     };

     var isLocalId = expenseId && String(expenseId).indexOf('local-') === 0;
     var isServerUpdate = expenseId && !isLocalId;

     if (!isServerUpdate) {
         expenseData.created_at = serverTimestamp();
     }

     var promise;
     if (isServerUpdate) {
         promise = updateDoc(doc(db, 'expenses', expenseId), expenseData);
     } else {
         promise = addDoc(collection(db, 'expenses'), expenseData);
     }

     applyWrite(promise, function (offline) {
         alert(offline ? (S.expenseSavedOffline || S.expenseSaved) : S.expenseSaved);
     });

     if (promise && typeof promise.then === 'function') {
         promise.then(function (ref) {
             if (!isServerUpdate && ref && ref.id) {
                 if (isLocalId) removeCachedExpense(expenseId);
                 else if (!expenseId) removeCachedExpense(tempId);
                 upsertCachedExpense(Object.assign({}, cacheEntry, { id: ref.id }));
                 syncExpensesLiveFromCache();
             }
             renderExpensesUI(expenseMonth);
             if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());
         }).catch(function (err) {
             console.error('Expense save sync error:', err);
         });
     }
 }

 function deleteExpense(expenseId) {
     var S = i18n[localStorage.getItem('selectedLang') || 'ku'] || i18n.en;
     if (!confirm(S.deleteExpenseConfirm)) return;

     removeCachedExpense(expenseId);
     syncExpensesLiveFromCache();
     var monthSelect = document.getElementById('expensesMonthSelect');
     var month = monthSelect ? parseInt(monthSelect.value, 10) : new Date().getMonth();
     renderExpensesUI(month);
     if (document.getElementById('todaySales')) renderDashboardUI(getDashboardMonth());

     if (!window.db || String(expenseId).indexOf('local-') === 0) {
         alert(S.expenseDeleted);
         return;
     }

     applyWrite(deleteDoc(doc(db, 'expenses', expenseId)), function (offline) {
         alert(offline ? (S.expenseDeletedOffline || S.expenseDeleted) : S.expenseDeleted);
     });
 }

 /* ============ LOGOUT ============ */

function handleLogout() {
    stopDashboardListeners();
    if (USE_LOCAL_API) {
        localStorage.removeItem('adminAuthToken');
        localStorage.removeItem('adminUser');
        window.currentAuthToken = null;
        window.currentUser = null;
        window.location.href = 'login.html';
        return;
    }
    if (window.auth) {
        auth.signOut().then(function () {
            window.location.href = 'login.html';
        }).catch(function () {
            window.location.href = 'login.html';
        });
    } else {
        window.location.href = 'login.html';
    }
}

