// Local API - replaces Firebase with PHP + SQLite
var API_BASE = 'api';

function getApiUrl(endpoint) {
    var url = API_BASE + '/' + endpoint;
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
        return url;
    }
    var origin = (window.location && window.location.origin) ? window.location.origin : '';
    var pathname = (window.location && window.location.pathname) ? window.location.pathname : '';
    if (!origin) {
        origin = 'http://localhost';
    }
    var prefix = '';
    if (pathname && pathname !== '/' && pathname.indexOf('/' + API_BASE) === -1) {
        var parts = pathname.split('/');
        parts.pop();
        prefix = parts.join('/') + '/';
    }
    return origin + prefix + url;
}

function apiRequest(endpoint, options) {
    options = options || {};
    var url = getApiUrl(endpoint);
    var method = options.method || 'GET';
    var body = options.body || null;
    var headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    
    if (options.auth && window.currentAuthToken) {
        headers['Authorization'] = 'Bearer ' + window.currentAuthToken;
    }
    
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
    }).catch(function(err) {
        var msg = (err && err.message) ? err.message : 'Network Error';
        if (msg.indexOf('Failed to fetch') !== -1 || msg.indexOf('NetworkError') !== -1 || msg.indexOf('Network Error') !== -1) {
            console.error('[API] Network error for:', url, '| origin:', window.location.origin, '| Make sure you are using http://localhost/brew-coffee/ not 127.0.0.1:5501');
        }
        throw err;
    });
}

// Menu Items API
var menuItemsApi = {
    getAll: function() {
        return apiRequest('menu_items.php');
    },
    getById: function(id) {
        return apiRequest('menu_items.php/' + id);
    },
    create: function(data) {
        return apiRequest('menu_items.php', {
            method: 'POST',
            body: data
        });
    },
    update: function(id, data) {
        return apiRequest('menu_items.php/' + id, {
            method: 'PUT',
            body: data
        });
    },
    delete: function(id) {
        return apiRequest('menu_items.php/' + id, {
            method: 'DELETE'
        });
    }
};

// Categories API
var categoriesApi = {
    getAll: function() {
        return apiRequest('categories.php');
    },
    getById: function(id) {
        return apiRequest('categories.php/' + id);
    },
    create: function(data) {
        return apiRequest('categories.php', {
            method: 'POST',
            body: data
        });
    },
    update: function(id, data) {
        return apiRequest('categories.php/' + id, {
            method: 'PUT',
            body: data
        });
    },
    delete: function(id) {
        return apiRequest('categories.php/' + id, {
            method: 'DELETE'
        });
    }
};

// Sales API
var salesApi = {
    getAll: function(month) {
        var url = 'sales.php';
        if (month) {
            url += '?month=' + encodeURIComponent(month);
        }
        return apiRequest(url);
    },
    getById: function(id) {
        return apiRequest('sales.php/' + id);
    },
    create: function(data) {
        return apiRequest('sales.php', {
            method: 'POST',
            body: data
        });
    },
    delete: function(id) {
        return apiRequest('sales.php/' + id, {
            method: 'DELETE'
        });
    }
};

// Expenses API
var expensesApi = {
    getAll: function(month) {
        var url = 'expenses.php';
        if (month) {
            url += '?month=' + encodeURIComponent(month);
        }
        return apiRequest(url);
    },
    getById: function(id) {
        return apiRequest('expenses.php/' + id);
    },
    create: function(data) {
        return apiRequest('expenses.php', {
            method: 'POST',
            body: data
        });
    },
    update: function(id, data) {
        return apiRequest('expenses.php/' + id, {
            method: 'PUT',
            body: data
        });
    },
    delete: function(id) {
        return apiRequest('expenses.php/' + id, {
            method: 'DELETE'
        });
    }
};

// Settings API
var settingsApi = {
    get: function(id) {
        return apiRequest('settings.php?id=' + encodeURIComponent(id || 'cafe'));
    },
    save: function(id, data) {
        return apiRequest('settings.php', {
            method: 'POST',
            body: { id: id || 'cafe', data: data }
        });
    }
};

// Auth API
var authApi = {
    login: function(email, password) {
        return apiRequest('auth.php', {
            method: 'POST',
            body: { email: email, password: password }
        });
    },
    check: function() {
        return apiRequest('auth.php', { method: 'GET' });
    },
    logout: function() {
        return apiRequest('auth.php', { method: 'DELETE' });
    }
};

// Subscription API
var subscriptionApi = {
    get: function(id) {
        return apiRequest('subscription.php?id=' + encodeURIComponent(id || 'brew-coffee'));
    },
    save: function(data) {
        return apiRequest('subscription.php', {
            method: 'POST',
            body: data
        });
    }
};

// Export for use
window.menuItemsApi = menuItemsApi;
window.categoriesApi = categoriesApi;
window.salesApi = salesApi;
window.expensesApi = expensesApi;
window.settingsApi = settingsApi;
window.authApi = authApi;
window.subscriptionApi = subscriptionApi;

