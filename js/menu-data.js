// js/menu-data.js - Optimized shared data layer
// Uses onSnapshot as the primary source with a get() timeout fallback.
// Caches items and categories in memory so filtering is instant and
// menu.html / admin.html only read Firestore once per page load.
(function () {
    'use strict';

    var _items = [];
    var _categories = [];
    var _itemsUnsub = null;
    var _categoriesUnsub = null;
    var _lastItemsOnUpdate = null;
    var _lastCategoriesOnUpdate = null;

    try {
        localStorage.removeItem('brew_test_menu_mode');
        localStorage.removeItem('brew_test_categories');
        localStorage.removeItem('brew_test_items');
    } catch (e) {}

    function getCombinedItems(baseItems) {
        return baseItems || _items;
    }

    function getCombinedCategories(baseCats) {
        return baseCats || _categories;
    }

    function isMobileBrowser() {
        return window.innerWidth <= 1024 ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function whenDbReady(fn) {
        var p = window.dbReady || Promise.resolve(window.db);
        return Promise.resolve(p).then(function () {
            if (typeof fn === 'function') fn(window.db);
            return window.db;
        }).catch(function () {
            if (typeof fn === 'function') fn(window.db);
            return window.db;
        });
    }

    function collectItemDocs(snap) {
        var docs = [];
        snap.forEach(function (d) {
            var data = d.data();
            if (data.category && data.category.toLowerCase().trim() === 'water') return;
            var obj = { id: d.id };
            for (var key in data) { obj[key] = data[key]; }
            docs.push(obj);
        });
        return docs;
    }

    function loadItems(timeoutMs, onUpdate, onError) {
        if (_itemsUnsub) { _itemsUnsub(); _itemsUnsub = null; }
        if (typeof onUpdate === 'function') _lastItemsOnUpdate = onUpdate;

        whenDbReady(function (db) {
            if (!db) {
                if (typeof onError === 'function') onError(new Error('No DB'));
                return;
            }

            var defaultTimeout = isMobileBrowser() ? 4000 : 2000;
            var softTimeout = timeoutMs || defaultTimeout;
            var hardTimeout = Math.max(softTimeout + 4000, isMobileBrowser() ? 12000 : 8000);
            var settled = false;
            var softTimer = null;
            var hardTimer = null;

            function finishUpdate(list) {
                settled = true;
                if (softTimer) clearTimeout(softTimer);
                if (hardTimer) clearTimeout(hardTimer);
                if (typeof onUpdate === 'function') onUpdate(getCombinedItems(list));
            }

            function finishError(err) {
                if (settled) return;
                settled = true;
                if (softTimer) clearTimeout(softTimer);
                if (hardTimer) clearTimeout(hardTimer);
                if (typeof onError === 'function') onError(err || new Error('Connection timeout'));
            }

            softTimer = setTimeout(function () {
                if (settled) return;
                getDocs(collection(db, 'menuItems'), { source: 'server' })
                    .then(function (snap) {
                        _items.length = 0;
                        _items.push.apply(_items, collectItemDocs(snap));
                        finishUpdate(_items.slice());
                    })
                    .catch(function () {
                        return getDocs(collection(db, 'menuItems')).then(function (snap) {
                            _items.length = 0;
                            _items.push.apply(_items, collectItemDocs(snap));
                            finishUpdate(_items.slice());
                        });
                    })
                    .catch(function (err) {
                        // Keep waiting for onSnapshot / hard timeout unless empty memory.
                        if (!_items.length) finishError(err);
                    });
            }, softTimeout);

            hardTimer = setTimeout(function () {
                if (_items.length) {
                    finishUpdate(_items.slice());
                } else {
                    finishError(new Error('Connection timeout'));
                }
            }, hardTimeout);

            _itemsUnsub = onSnapshot(collection(db, 'menuItems'),
                function (snap) {
                    // Clear soft timer on any snapshot (including empty / cache).
                    if (softTimer) {
                        clearTimeout(softTimer);
                        softTimer = null;
                    }
                    _items.length = 0;
                    _items.push.apply(_items, collectItemDocs(snap));
                    if (typeof onUpdate === 'function') onUpdate(getCombinedItems(_items.slice()));
                    if (!snap.metadata.fromCache || _items.length > 0) {
                        settled = true;
                        if (hardTimer) {
                            clearTimeout(hardTimer);
                            hardTimer = null;
                        }
                    }
                },
                function (err) {
                    console.warn('[menu-data] items error:', err.message);
                    finishError(err);
                }
            );
        });
    }

    function sortCategoriesList(list) {
        list.sort(function (a, b) {
            var da = (a && a.data) ? a.data : a;
            var db_ = (b && b.data) ? b.data : b;
            var ao = (da && da.order != null && da.order !== '') ? Number(da.order) : NaN;
            var bo = (db_ && db_.order != null && db_.order !== '') ? Number(db_.order) : NaN;
            if (!isNaN(ao) && !isNaN(bo) && ao !== bo) return ao - bo;
            if (!isNaN(ao) && isNaN(bo)) return -1;
            if (isNaN(ao) && !isNaN(bo)) return 1;
            return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
        });
        return list;
    }

    function applyCategoriesSnap(snap, onUpdate) {
        _categories.length = 0;
        snap.forEach(function (doc) {
            _categories.push({ id: doc.id, data: doc.data() });
        });
        sortCategoriesList(_categories);
        onUpdate(getCombinedCategories(_categories.slice()));
    }

    function loadCategories(timeoutMs, onUpdate, onError) {
        if (_categoriesUnsub) { _categoriesUnsub(); _categoriesUnsub = null; }
        if (typeof onUpdate === 'function') _lastCategoriesOnUpdate = onUpdate;

        whenDbReady(function (db) {
            if (!db) {
                if (typeof onError === 'function') onError(new Error('No DB'));
                return;
            }

            // Do NOT use orderBy('order') — docs missing `order` are excluded by Firestore.
            var defaultTimeout = isMobileBrowser() ? 4000 : 2000;
            var softTimeout = timeoutMs || defaultTimeout;
            var hardTimeout = Math.max(softTimeout + 4000, isMobileBrowser() ? 12000 : 8000);
            var settled = false;
            var softTimer = null;
            var hardTimer = null;

            function finishUpdate(list) {
                settled = true;
                if (softTimer) clearTimeout(softTimer);
                if (hardTimer) clearTimeout(hardTimer);
                if (typeof onUpdate === 'function') onUpdate(getCombinedCategories(list));
            }

            function finishError(err) {
                if (settled) return;
                settled = true;
                if (softTimer) clearTimeout(softTimer);
                if (hardTimer) clearTimeout(hardTimer);
                if (typeof onError === 'function') onError(err || new Error('Connection timeout'));
            }

            softTimer = setTimeout(function () {
                if (settled) return;
                getDocs(collection(db, 'categories'), { source: 'server' })
                    .then(function (snap) {
                        applyCategoriesSnap(snap, finishUpdate);
                    })
                    .catch(function () {
                        return getDocs(collection(db, 'categories')).then(function (snap) {
                            applyCategoriesSnap(snap, finishUpdate);
                        });
                    })
                    .catch(function (err) {
                        if (!_categories.length) finishError(err);
                    });
            }, softTimeout);

            hardTimer = setTimeout(function () {
                if (_categories.length) {
                    finishUpdate(_categories.slice());
                } else {
                    finishError(new Error('Connection timeout'));
                }
            }, hardTimeout);

            _categoriesUnsub = onSnapshot(collection(db, 'categories'),
                function (snap) {
                    if (softTimer) {
                        clearTimeout(softTimer);
                        softTimer = null;
                    }
                    applyCategoriesSnap(snap, function (list) {
                        if (typeof onUpdate === 'function') onUpdate(list);
                    });
                    if (!snap.metadata.fromCache || _categories.length > 0) {
                        settled = true;
                        if (hardTimer) {
                            clearTimeout(hardTimer);
                            hardTimer = null;
                        }
                    }
                },
                function (err) {
                    console.warn('[menu-data] categories error:', err.message);
                    finishError(err);
                }
            );
        });
    }

    function getItems() { return getCombinedItems(_items); }
    function getCategories() { return getCombinedCategories(_categories); }

    function filterItems(searchTerm, category) {
        var filtered = getCombinedItems(_items).slice();
        if (searchTerm) {
            var lang = localStorage.getItem('selectedLang') || 'ku';
            var term = searchTerm.toLowerCase();
            filtered = filtered.filter(function (d) {
                var name = (d['name_' + lang] || d.name_en || d.name_ar || d.name_ku || '').toLowerCase();
                return name.indexOf(term) !== -1;
            });
        }
        if (category && category !== 'all') {
            var catLower = String(category).toLowerCase();
            filtered = filtered.filter(function (d) {
                return d.category && String(d.category).toLowerCase() === catLower;
            });
        }
        return filtered;
    }

    function unsubscribeAll() {
        if (_itemsUnsub) { _itemsUnsub(); _itemsUnsub = null; }
        if (_categoriesUnsub) { _categoriesUnsub(); _categoriesUnsub = null; }
    }

    window.MenuData = {
        loadItems: loadItems,
        loadCategories: loadCategories,
        getItems: getItems,
        getCategories: getCategories,
        filterItems: filterItems,
        unsubscribeAll: unsubscribeAll,
        syncTestMode: function () {}
    };
})();
