/**
 * Smart Serve license — developer only.
 * Cafe owners with admin login cannot change this.
 *
 * expireDate: 'YYYY-MM-DD'  → menu locks after that day ends
 * expireDate: ''            → never expires
 *
 * Preview anytime: menu.html?expired=1
 */
window.MENU_LICENSE = {
    expireDate: '2028-08-08',
    contactName: 'Smart Serve'
};

window.isMenuExpirePreviewRequested = function () {
    try {
        var params = new URLSearchParams(window.location.search || '');
        var flag = (params.get('expired') || params.get('preview') || '').toLowerCase();
        return flag === '1' || flag === 'true' || flag === 'expired' || flag === 'yes';
    } catch (e) {
        return false;
    }
};

window.getMenuLicenseExpireDate = function () {
    try { localStorage.removeItem('menuExpireDate'); } catch (e) {}
    var license = window.MENU_LICENSE || {};
    return String(license.expireDate || '').trim();
};

window.getMenuExpireEndMs = function (dateStr) {
    var raw = String(dateStr || '').trim();
    if (!raw) return null;
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
        var parsed = Date.parse(raw);
        return isNaN(parsed) ? null : parsed;
    }
    var end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
    return end.getTime();
};

var isMenuExpirePreviewRequested = window.isMenuExpirePreviewRequested;
var getMenuLicenseExpireDate = window.getMenuLicenseExpireDate;
var getMenuExpireEndMs = window.getMenuExpireEndMs;

