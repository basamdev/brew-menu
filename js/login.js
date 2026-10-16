// Login.js - Handles admin authentication with Firebase and local fallbacks

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const loginBox = document.getElementById('loginBox');
    const loginError = document.getElementById('loginError');
    const loginErrorText = document.getElementById('loginErrorText');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('loginBtn');
    const btnText = loginBtn ? loginBtn.querySelector('.btn-text') : null;
    const btnSpinner = loginBtn ? loginBtn.querySelector('.btn-spinner') : null;
    const pwdToggleBtn = document.getElementById('pwdToggleBtn');
    const pwdEyeIcon = document.getElementById('pwdEyeIcon');

    // Toggle password visibility
    if (pwdToggleBtn && passwordInput && pwdEyeIcon) {
        pwdToggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                pwdEyeIcon.classList.remove('fa-eye');
                pwdEyeIcon.classList.add('fa-eye-slash');
            } else {
                passwordInput.type = 'password';
                pwdEyeIcon.classList.remove('fa-eye-slash');
                pwdEyeIcon.classList.add('fa-eye');
            }
        });
    }

    function showErrorMessage(message) {
        if (!loginError) return;
        if (loginErrorText) {
            loginErrorText.textContent = message || 'Wrong email or wrong password';
        } else {
            loginError.textContent = message || 'Wrong email or wrong password';
        }
        loginError.style.display = 'flex';

        if (emailInput) emailInput.classList.add('input-error');
        if (passwordInput) passwordInput.classList.add('input-error');

        if (loginBox) {
            loginBox.classList.remove('shake');
            void loginBox.offsetWidth; // Trigger reflow to restart CSS animation
            loginBox.classList.add('shake');
        }
    }

    function hideErrorMessage() {
        if (loginError) loginError.style.display = 'none';
        if (emailInput) emailInput.classList.remove('input-error');
        if (passwordInput) passwordInput.classList.remove('input-error');
    }

    function setLoading(isLoading) {
        if (!loginBtn) return;
        loginBtn.disabled = isLoading;
        if (btnText) btnText.style.display = isLoading ? 'none' : 'inline-block';
        if (btnSpinner) btnSpinner.style.display = isLoading ? 'inline-flex' : 'none';
    }

    [emailInput, passwordInput].forEach(function(inp) {
        if (!inp) return;
        inp.addEventListener('input', function() {
            hideErrorMessage();
        });
    });

    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            hideErrorMessage();

            const email = (emailInput ? emailInput.value : '').trim();
            const password = passwordInput ? passwordInput.value : '';

            if (!email || !password) {
                showErrorMessage('تکایە هەردوو خانەی ئیمەیڵ و وشەی نهێنی پڕبکەرەوە / Please fill in both email and password');
                return;
            }

            setLoading(true);

            // 1. If local API is explicitly enabled
            if (typeof USE_LOCAL_API !== 'undefined' && USE_LOCAL_API && typeof authApi !== 'undefined') {
                authApi.login(email, password).then(function(response) {
                    if (response.token) {
                        window.currentAuthToken = response.token;
                        window.currentUser = response.user;
                        localStorage.setItem('adminAuthToken', response.token);
                        localStorage.setItem('adminUser', JSON.stringify(response.user));
                    }
                    hideErrorMessage();
                    window.location.replace('admin.html');
                }).catch(function() {
                    setLoading(false);
                    showErrorMessage('Wrong email or wrong password / ئیمەیڵ یان وشەی نهێنی هەڵەیە');
                });
                return;
            }

            // 2. Firebase Authentication
            function executeFirebaseAuth() {
                var authInstance = window.auth;
                if (!authInstance || typeof signInWithEmailAndPassword !== 'function') {
                    setLoading(false);
                    showErrorMessage('Firebase Auth is initializing... Please retry in a second.');
                    return;
                }

                signInWithEmailAndPassword(authInstance, email, password)
                    .then(function(userCredential) {
                        hideErrorMessage();
                        try {
                            localStorage.setItem('adminUserEmail', (userCredential.user && userCredential.user.email) || email);
                            localStorage.setItem('adminLoginTime', String(Date.now()));
                        } catch (err) {}
                        window.location.replace('admin.html');
                    })
                    .catch(function(error) {
                        setLoading(false);
                        const errorCode = (error && error.code) || '';
                        console.warn('Firebase login attempt failed:', errorCode, error.message);

                        if (
                            errorCode === 'auth/invalid-credential' ||
                            errorCode === 'auth/invalid-login-credentials' ||
                            errorCode === 'auth/user-not-found' ||
                            errorCode === 'auth/wrong-password' ||
                            errorCode === 'auth/invalid-email'
                        ) {
                            showErrorMessage('Wrong email or wrong password / ئیمەیڵ یان وشەی نهێنی هەڵەیە');
                        } else if (errorCode === 'auth/too-many-requests') {
                            showErrorMessage('هەوڵی زۆری نادروست درا، تکایە کەمێکی تر دووبارە بکەرەوە / Too many attempts. Please try again later.');
                        } else if (errorCode === 'auth/operation-not-allowed') {
                            showErrorMessage('⚠️ لە Firebase Console بەشی Authentication ➔ Sign-in method پێویستە Email/Password چالاک (Enable) بکرێت');
                        } else if (errorCode === 'auth/network-request-failed') {
                            showErrorMessage('کێشەی هێڵی ئینتەرنێت هەیە، تکایە هێڵەکەت بپشکنە / Network error. Please check your internet.');
                        } else {
                            showErrorMessage('Wrong email or wrong password / ئیمەیڵ یان وشەی نهێنی هەڵەیە');
                        }
                    });
            }

            if (window.auth && typeof signInWithEmailAndPassword === 'function') {
                executeFirebaseAuth();
            } else {
                setTimeout(executeFirebaseAuth, 350);
            }
        });
    }

    // Auto-forward if user is already authenticated
    if (typeof USE_LOCAL_API === 'undefined' || !USE_LOCAL_API) {
        function checkExistingAuth() {
            if (typeof onAuthStateChanged === 'function' && window.auth) {
                onAuthStateChanged(window.auth, function(user) {
                    if (user) {
                        window.location.replace('admin.html');
                    }
                });
            } else {
                setTimeout(checkExistingAuth, 250);
            }
        }
        checkExistingAuth();
    }
});
