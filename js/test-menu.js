// js/test-menu.js - Legacy cleanup stub
(function () {
    'use strict';
    try {
        localStorage.removeItem('brew_test_menu_mode');
        localStorage.removeItem('brew_test_categories');
        localStorage.removeItem('brew_test_items');
    } catch (e) {}

    window.TestMenu = {
        isTestModeActive: function () { return false; },
        getTestCategories: function () { return []; },
        getTestItems: function () { return []; },
        injectTestMenu: function () { return { success: false, error: 'Disabled' }; },
        clearTestMenu: function () {
            try {
                localStorage.removeItem('brew_test_menu_mode');
                localStorage.removeItem('brew_test_categories');
                localStorage.removeItem('brew_test_items');
            } catch (e) {}
            return true;
        },
        sampleCategories: [],
        sampleItems: []
    };
})();
