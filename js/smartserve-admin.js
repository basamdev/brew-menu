// SmartServe Super Admin Portal Controller
// Dedicated subscription management with custom claims validation & audit logging

(function () {
    'use strict';

    // Elements
    var authGate = document.getElementById('ssAuthGate');
    var mainLayout = document.getElementById('ssMainLayout');
    var loginForm = document.getElementById('ssLoginForm');
    var loginEmail = document.getElementById('ssLoginEmail');
    var loginPassword = document.getElementById('ssLoginPassword');
    var loginError = document.getElementById('ssAuthError');
    var loginBtnText = document.getElementById('ssLoginBtnText');
    var loginSpinner = document.getElementById('ssLoginSpinner');
    var logoutBtn = document.getElementById('ssLogoutBtn');
    var userEmailEl = document.getElementById('ssAdminUserEmail');

    var tableBody = document.getElementById('ssSubscriptionTableBody');
    var auditTableBody = document.getElementById('ssAuditTableBody');
    var searchInput = document.getElementById('ssSearchInput');
    var filterChips = document.getElementById('ssFilterChips');

    var kpiTotal = document.getElementById('kpiTotal');
    var kpiActive = document.getElementById('kpiActive');
    var kpiExpired = document.getElementById('kpiExpired');
    var kpiExpiringSoon = document.getElementById('kpiExpiringSoon');

    var modalOverlay = document.getElementById('ssSubscriptionModal');
    var btnOpenAddModal = document.getElementById('btnOpenAddModal');
    var btnCloseModal = document.getElementById('btnCloseModal');
    var subForm = document.getElementById('ssSubscriptionForm');
    var modalRestaurantId = document.getElementById('modalRestaurantId');
    var modalRestaurantName = document.getElementById('modalRestaurantName');
    var modalPeriodYears = document.getElementById('modalPeriodYears');
    var modalCustomDateWrap = document.getElementById('modalCustomDateWrap');
    var modalCustomDate = document.getElementById('modalCustomDate');
    var btnRefreshAuditLogs = document.getElementById('btnRefreshAuditLogs');

    // State
    var allSubscriptions = [];
    var currentFilter = 'all';
    var searchQuery = '';
    var currentUser = null;
    var isSuperAdminUser = false;

    // Designated master superadmin emails (fallback bootstrap before custom claim is set)
    var BOOTSTRAP_SUPERADMIN_EMAILS = [
        'smartserve@admin.com',
        'superadmin@smartserve.com',
        'admin@smartserve.com'
    ];

    function showAuthError(msg) {
        if (!loginError) return;
        loginError.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' + msg;
        loginError.style.display = 'block';
    }

    function hideAuthError() {
        if (!loginError) return;
        loginError.style.display = 'none';
    }

    function setLoginLoading(isLoading) {
        var btn = document.getElementById('ssLoginBtn');
        if (btn) btn.disabled = isLoading;
        if (loginBtnText) loginBtnText.style.display = isLoading ? 'none' : 'inline-block';
        if (loginSpinner) loginSpinner.style.display = isLoading ? 'inline-block' : 'none';
    }

    // 1. Auth Flow & Custom Claims Verification
    function initAuth() {
        if (!window.auth || typeof onAuthStateChanged !== 'function') {
            setTimeout(initAuth, 150);
            return;
        }

        onAuthStateChanged(auth, function (user) {
            currentUser = user;
            if (!user) {
                // Not logged in -> show login gate
                authGate.style.display = 'flex';
                mainLayout.style.display = 'none';
                return;
            }

            // Verify Super Admin Authorization via Custom Claims
            user.getIdTokenResult(true).then(function (tokenResult) {
                var claims = tokenResult.claims || {};
                var email = (user.email || '').toLowerCase().trim();

                var hasClaim = (claims.superadmin === true || claims.admin === true);
                var isBootstrapEmail = BOOTSTRAP_SUPERADMIN_EMAILS.indexOf(email) !== -1;

                if (hasClaim || isBootstrapEmail) {
                    // Authorized Super Admin
                    isSuperAdminUser = true;
                    authGate.style.display = 'none';
                    mainLayout.style.display = 'block';
                    if (userEmailEl) userEmailEl.textContent = user.email || 'SmartServe Admin';
                    loadSubscriptions();
                    loadAuditLogs();
                } else {
                    // Regular restaurant owner or unauthorized user!
                    isSuperAdminUser = false;
                    authGate.style.display = 'flex';
                    mainLayout.style.display = 'none';
                    showAuthError('⛔ <b>Access Denied:</b> Account <i>' + escapeHtml(user.email) + '</i> does not have SmartServe Super Admin privileges.<br><br>Restaurant owners can only access <a href="login.html" style="color:#D4AF37;">login.html</a>.');
                }
            }).catch(function (err) {
                console.error('Error fetching token claims:', err);
                showAuthError('Error checking security credentials: ' + (err.message || err));
            });
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            e.preventDefault();
            hideAuthError();
            var email = (loginEmail.value || '').trim();
            var password = loginPassword.value || '';

            if (!email || !password) {
                showAuthError('Please enter both email and password.');
                return;
            }

            setLoginLoading(true);
            signInWithEmailAndPassword(auth, email, password).then(function () {
                setLoginLoading(false);
            }).catch(function (err) {
                setLoginLoading(false);
                var code = err.code || '';
                if (code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
                    showAuthError('Incorrect Super Admin email or password.');
                } else {
                    showAuthError('Authentication error: ' + (err.message || code));
                }
            });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            if (window.auth && typeof signOut === 'function') {
                signOut(auth).then(function () {
                    window.location.reload();
                });
            }
        });
    }

    // 2. Load and Manage Subscriptions
    function loadSubscriptions() {
        if (!window.db || typeof getDocs !== 'function' || typeof collection !== 'function') {
            setTimeout(loadSubscriptions, 200);
            return;
        }

        getDocs(collection(db, 'subscriptions')).then(function (snap) {
            allSubscriptions = [];
            snap.forEach(function (docSnap) {
                var d = docSnap.data() || {};
                d.restaurantId = d.restaurantId || docSnap.id;
                allSubscriptions.push(d);
            });

            // Ensure brew-coffee exists as primary default if collection is empty
            if (!allSubscriptions.length) {
                allSubscriptions.push({
                    restaurantId: 'brew-coffee',
                    restaurantName: 'Brew Cafe & Rest',
                    status: 'active',
                    periodYears: 1,
                    activatedAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 365 * 86400000).toISOString()
                });
            }

            renderDashboard();
        }).catch(function (err) {
            console.error('Error loading subscriptions:', err);
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#EF4444;">Error loading subscriptions: ' + escapeHtml(err.message || String(err)) + '</td></tr>';
        });
    }

    function calculateStatus(sub) {
        var isExp = false;
        var expMs = null;
        var st = String(sub.status || 'active').toLowerCase();

        if (st === 'expired' || st === 'disabled' || st === 'inactive') {
            isExp = true;
        }

        if (sub.expiresAt) {
            if (typeof sub.expiresAt.toDate === 'function') {
                expMs = sub.expiresAt.toDate().getTime();
            } else if (sub.expiresAt.seconds != null) {
                expMs = sub.expiresAt.seconds * 1000;
            } else {
                expMs = Date.parse(sub.expiresAt);
            }
            if (!isNaN(expMs) && Date.now() > expMs) {
                isExp = true;
            }
        }

        var daysDiff = null;
        if (expMs && !isNaN(expMs)) {
            daysDiff = Math.ceil((expMs - Date.now()) / (86400000));
        }

        return {
            isExpired: isExp,
            expMs: expMs,
            daysDiff: daysDiff,
            isExpiringSoon: (!isExp && daysDiff != null && daysDiff >= 0 && daysDiff <= 30)
        };
    }

    function renderDashboard() {
        // Update KPIs
        var total = allSubscriptions.length;
        var active = 0;
        var expired = 0;
        var soon = 0;

        allSubscriptions.forEach(function (sub) {
            var st = calculateStatus(sub);
            if (st.isExpired) expired++;
            else active++;
            if (st.isExpiringSoon) soon++;
        });

        if (kpiTotal) kpiTotal.textContent = total;
        if (kpiActive) kpiActive.textContent = active;
        if (kpiExpired) kpiExpired.textContent = expired;
        if (kpiExpiringSoon) kpiExpiringSoon.textContent = soon;

        // Filter and Search
        var filtered = allSubscriptions.filter(function (sub) {
            var st = calculateStatus(sub);
            if (currentFilter === 'active' && st.isExpired) return false;
            if (currentFilter === 'expired' && !st.isExpired) return false;
            if (currentFilter === 'soon' && !st.isExpiringSoon) return false;

            if (searchQuery) {
                var q = searchQuery.toLowerCase();
                var rId = String(sub.restaurantId || '').toLowerCase();
                var rName = String(sub.restaurantName || '').toLowerCase();
                if (rId.indexOf(q) === -1 && rName.indexOf(q) === -1) return false;
            }
            return true;
        });

        if (!filtered.length) {
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px; color:#A8A29E;">No restaurant subscriptions found matching current filter.</td></tr>';
            return;
        }

        var html = '';
        filtered.forEach(function (sub) {
            var st = calculateStatus(sub);
            var rId = sub.restaurantId;
            var rName = sub.restaurantName || rId;

            var badge = st.isExpired
                ? '<span class="ss-badge expired">🔴 EXPIRED</span>'
                : (st.isExpiringSoon
                    ? '<span class="ss-badge warning">🟡 EXPIRING SOON</span>'
                    : '<span class="ss-badge active">🟢 ACTIVE</span>');

            var remainingText = '—';
            if (st.daysDiff != null) {
                if (st.daysDiff > 0) {
                    remainingText = '<span style="color:' + (st.daysDiff <= 30 ? '#F59E0B' : '#FAF8F5') + '; font-weight:700;">' + st.daysDiff + ' days left</span>';
                } else {
                    remainingText = '<span style="color:#EF4444; font-weight:700;">Expired ' + Math.abs(st.daysDiff) + 'd ago</span>';
                }
            }

            var previewUrl = 'menu.html?restaurant=' + encodeURIComponent(rId) + '&expired=1';
            var liveUrl = 'menu.html?restaurant=' + encodeURIComponent(rId);

            html += '<tr>' +
                '<td>' +
                    '<div style="font-weight:700; color:#FAF8F5;">' + escapeHtml(rName) + '</div>' +
                    '<div style="font-family:monospace; font-size:0.8rem; color:#D4AF37;">ID: ' + escapeHtml(rId) + '</div>' +
                '</td>' +
                '<td>' + badge + '</td>' +
                '<td>' + formatDate(sub.activatedAt) + '</td>' +
                '<td><strong style="color:' + (st.isExpired ? '#EF4444' : '#D4AF37') + ';">' + formatDate(sub.expiresAt) + '</strong></td>' +
                '<td>' + remainingText + '</td>' +
                '<td>' +
                    '<div class="ss-action-btns">' +
                        '<button type="button" class="ss-btn-sm renew btn-action-renew" data-rid="' + escapeHtml(rId) + '" data-rname="' + escapeHtml(rName) + '" title="Renew for 1 full calendar year">' +
                            '<i class="fa-solid fa-bolt"></i> +1 Year' +
                        '</button>' +
                        '<button type="button" class="ss-btn-sm link btn-action-custom" data-rid="' + escapeHtml(rId) + '" data-rname="' + escapeHtml(rName) + '" title="Custom years or date">' +
                            '<i class="fa-solid fa-calendar-days"></i> Custom' +
                        '</button>' +
                        '<button type="button" class="ss-btn-sm danger btn-action-expire" data-rid="' + escapeHtml(rId) + '" title="Deactivate / Mark Expired">' +
                            '<i class="fa-solid fa-ban"></i>' +
                        '</button>' +
                        '<a href="' + previewUrl + '" target="_blank" class="ss-btn-sm link" title="Preview Expired Screen">' +
                            '<i class="fa-regular fa-eye"></i>' +
                        '</a>' +
                        '<a href="' + liveUrl + '" target="_blank" class="ss-btn-sm link" title="Open Customer Menu">' +
                            '<i class="fa-solid fa-arrow-up-right-from-square"></i>' +
                        '</a>' +
                    '</div>' +
                '</td>' +
            '</tr>';
        });

        tableBody.innerHTML = html;
    }

    // 3. Actions: Quick 1-Year Renewal, Custom Period, and Deactivation
    function saveSubscription(rId, rName, periodYears, customDateStr, actionType) {
        var now = new Date();
        var targetExp = new Date(now.getTime());

        if (periodYears === 'custom' && customDateStr) {
            targetExp = new Date(customDateStr + 'T23:59:59');
        } else {
            var yrs = parseInt(periodYears, 10) || 1;
            targetExp.setFullYear(now.getFullYear() + yrs);
        }

        var existing = allSubscriptions.find(function (s) { return s.restaurantId === rId; });
        var prevExpiry = existing && existing.expiresAt ? (existing.expiresAt.toDate ? existing.expiresAt.toDate().toISOString() : existing.expiresAt) : 'None';

        var firestorePayload = {
            restaurantId: rId,
            restaurantName: rName,
            status: 'active',
            periodYears: (periodYears === 'custom' ? 'custom' : parseInt(periodYears, 10) || 1),
            activatedAt: (existing && existing.activatedAt && existing.activatedAt.toDate) ? existing.activatedAt : (Timestamp ? Timestamp.fromDate(now) : now.toISOString()),
            lastRenewedAt: Timestamp ? Timestamp.fromDate(now) : now.toISOString(),
            expiresAt: Timestamp ? Timestamp.fromDate(targetExp) : targetExp.toISOString(),
            updatedAt: serverTimestamp ? serverTimestamp() : now.toISOString(),
            updatedBy: (currentUser && currentUser.email) || 'SmartServe Super Admin'
        };

        // Write to Firestore `subscriptions/{restaurantId}`
        setDoc(doc(db, 'subscriptions', rId), firestorePayload, { merge: true }).then(function () {
            // Write to Audit Log
            logAuditAction(rId, actionType || 'RENEWED_1_YEAR', prevExpiry, targetExp.toISOString(), {
                periodYears: periodYears,
                restaurantName: rName
            });

            alert('✨ Success! Subscription for ' + rId + ' activated/renewed until ' + targetExp.toLocaleDateString() + '.');
            closeModal();
            loadSubscriptions();
        }).catch(function (err) {
            console.error('Error saving subscription:', err);
            alert('⚠️ Error saving subscription: ' + (err.message || err));
        });
    }

    function expireSubscription(rId) {
        if (!confirm('Are you sure you want to immediately expire/deactivate menu subscription for: ' + rId + '?\n\nCustomers will immediately see the luxury expired screen.')) return;

        var now = new Date();
        var yesterday = new Date(now.getTime() - (86400000 * 2));
        var existing = allSubscriptions.find(function (s) { return s.restaurantId === rId; });
        var prevExpiry = existing && existing.expiresAt ? String(existing.expiresAt) : 'Unknown';

        var firestorePayload = {
            restaurantId: rId,
            status: 'expired',
            expiresAt: Timestamp ? Timestamp.fromDate(yesterday) : yesterday.toISOString(),
            updatedAt: serverTimestamp ? serverTimestamp() : now.toISOString(),
            updatedBy: (currentUser && currentUser.email) || 'SmartServe Super Admin'
        };

        setDoc(doc(db, 'subscriptions', rId), firestorePayload, { merge: true }).then(function () {
            logAuditAction(rId, 'DEACTIVATED_EXPIRED', prevExpiry, yesterday.toISOString(), {});
            alert('⚠️ Subscription for ' + rId + ' has been set to EXPIRED.');
            loadSubscriptions();
        }).catch(function (err) {
            alert('Error expiring subscription: ' + (err.message || err));
        });
    }

    // 4. Audit Trail Logging
    function logAuditAction(rId, action, prevExp, newExp, metadata) {
        if (!window.db || typeof addDoc !== 'function') return;
        var logEntry = {
            restaurantId: rId,
            action: action,
            previousExpiry: String(prevExp || ''),
            newExpiry: String(newExp || ''),
            metadata: metadata || {},
            adminEmail: (currentUser && currentUser.email) || 'superadmin@smartserve.com',
            adminUid: (currentUser && currentUser.uid) || 'unknown',
            timestamp: serverTimestamp ? serverTimestamp() : new Date().toISOString()
        };

        addDoc(collection(db, 'subscription_audit_logs'), logEntry).then(function () {
            loadAuditLogs();
        }).catch(function (e) {
            console.warn('Audit logging notice:', e);
        });
    }

    function loadAuditLogs() {
        if (!window.db || typeof getDocs !== 'function') return;
        if (!auditTableBody) return;

        var q = query(collection(db, 'subscription_audit_logs'), orderBy('timestamp', 'desc'), limit(15));
        getDocs(q).then(function (snap) {
            if (snap.empty) {
                auditTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#A8A29E;">No audit logs recorded yet.</td></tr>';
                return;
            }

            var html = '';
            snap.forEach(function (docSnap) {
                var d = docSnap.data() || {};
                var timeStr = formatDate(d.timestamp);
                var actionBadge = '<span class="ss-badge active" style="font-size:0.72rem;">' + escapeHtml(d.action || 'ACTION') + '</span>';
                if (String(d.action).indexOf('EXPIRED') !== -1 || String(d.action).indexOf('DEACTIVATE') !== -1) {
                    actionBadge = '<span class="ss-badge expired" style="font-size:0.72rem;">' + escapeHtml(d.action) + '</span>';
                }

                html += '<tr>' +
                    '<td>' + timeStr + '</td>' +
                    '<td style="font-family:monospace; color:#D4AF37;">' + escapeHtml(d.restaurantId || '—') + '</td>' +
                    '<td>' + actionBadge + '</td>' +
                    '<td><i class="fa-solid fa-user-shield" style="font-size:0.75rem; color:#D4AF37;"></i> ' + escapeHtml(d.adminEmail || 'admin') + '</td>' +
                    '<td style="color:#A8A29E; font-size:0.78rem;">' +
                        'Prev: ' + escapeHtml(String(d.previousExpiry).substring(0, 10)) + ' ➔ New: <span style="color:#FAF8F5;">' + escapeHtml(String(d.newExpiry).substring(0, 10)) + '</span>' +
                    '</td>' +
                '</tr>';
            });
            auditTableBody.innerHTML = html;
        }).catch(function (err) {
            console.warn('Could not load audit logs:', err);
            auditTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#A8A29E;">Audit log tracking active.</td></tr>';
        });
    }

    // Modal Handling
    function openModal(rId, rName) {
        if (!modalOverlay) return;
        if (modalRestaurantId) {
            modalRestaurantId.value = rId || '';
            modalRestaurantId.readOnly = !!rId;
        }
        if (modalRestaurantName) {
            modalRestaurantName.value = rName || (rId ? rId : '');
        }
        if (modalPeriodYears) modalPeriodYears.value = '1';
        if (modalCustomDateWrap) modalCustomDateWrap.style.display = 'none';
        modalOverlay.classList.add('active');
    }

    function closeModal() {
        if (!modalOverlay) return;
        modalOverlay.classList.remove('active');
    }

    if (btnOpenAddModal) {
        btnOpenAddModal.addEventListener('click', function () {
            openModal('', '');
        });
    }

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', closeModal);
    }

    if (modalPeriodYears) {
        modalPeriodYears.addEventListener('change', function () {
            if (this.value === 'custom') {
                modalCustomDateWrap.style.display = 'block';
            } else {
                modalCustomDateWrap.style.display = 'none';
            }
        });
    }

    if (subForm) {
        subForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var rId = (modalRestaurantId.value || '').trim();
            var rName = (modalRestaurantName.value || '').trim() || rId;
            var period = modalPeriodYears.value;
            var customDate = modalCustomDate ? modalCustomDate.value : '';

            if (!rId) {
                alert('Please enter a Restaurant ID.');
                return;
            }

            if (period === 'custom' && !customDate) {
                alert('Please select a specific expiration date.');
                return;
            }

            saveSubscription(rId, rName, period, customDate, 'SET_SUBSCRIPTION');
        });
    }

    // Search and Filters
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            searchQuery = (this.value || '').trim();
            renderDashboard();
        });
    }

    if (filterChips) {
        filterChips.addEventListener('click', function (e) {
            var chip = e.target.closest('.ss-chip');
            if (!chip) return;
            filterChips.querySelectorAll('.ss-chip').forEach(function (c) { c.classList.remove('active'); });
            chip.classList.add('active');
            currentFilter = chip.getAttribute('data-filter') || 'all';
            renderDashboard();
        });
    }

    if (btnRefreshAuditLogs) {
        btnRefreshAuditLogs.addEventListener('click', function () {
            loadAuditLogs();
        });
    }

    // Delegated actions on table
    if (tableBody) {
        tableBody.addEventListener('click', function (e) {
            var btnRenew = e.target.closest('.btn-action-renew');
            if (btnRenew) {
                var rid = btnRenew.getAttribute('data-rid');
                var rname = btnRenew.getAttribute('data-rname');
                if (confirm('Renew subscription for ' + rid + ' for 1 full calendar year?')) {
                    saveSubscription(rid, rname, 1, null, 'RENEWED_1_YEAR');
                }
                return;
            }

            var btnCustom = e.target.closest('.btn-action-custom');
            if (btnCustom) {
                var crid = btnCustom.getAttribute('data-rid');
                var crname = btnCustom.getAttribute('data-rname');
                openModal(crid, crname);
                return;
            }

            var btnExpire = e.target.closest('.btn-action-expire');
            if (btnExpire) {
                var erid = btnExpire.getAttribute('data-rid');
                expireSubscription(erid);
                return;
            }
        });
    }

    // Helpers
    function formatDate(val) {
        if (!val) return '—';
        var d = null;
        if (val instanceof Date) d = val;
        else if (val && typeof val.toDate === 'function') d = val.toDate();
        else if (val && val.seconds != null) d = new Date(val.seconds * 1000);
        else if (typeof val === 'string' || typeof val === 'number') {
            var ms = Date.parse(val);
            if (!isNaN(ms)) d = new Date(ms);
        }
        if (!d || isNaN(d.getTime())) return String(val).substring(0, 10);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Start
    initAuth();
})();
