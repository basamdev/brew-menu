/**
 * SmartServe Super Admin Cloud Functions
 * 
 * Provides server-side trusted execution for subscription activation, renewal,
 * and auditing using the Firebase Admin SDK.
 * 
 * Prerequisites:
 *   - Firebase Blaze (Pay-as-you-go) billing plan enabled in Google Cloud Console.
 *   - Deploy via: firebase deploy --only functions
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * Callable Function: renewRestaurantSubscription
 * Enforces that only callers with custom claim `superadmin: true` can modify subscriptions.
 */
exports.renewRestaurantSubscription = functions.https.onCall(async (data, context) => {
    // 1. Enforce Authentication
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Authentication required to perform this action.'
        );
    }

    // 2. Enforce Super Admin Custom Claim
    const isSuperAdmin = context.auth.token.superadmin === true || context.auth.token.admin === true;
    if (!isSuperAdmin) {
        throw new functions.https.HttpsError(
            'permission-denied',
            'Access denied: Only SmartServe Super Administrators can manage restaurant subscriptions.'
        );
    }

    const restaurantId = (data.restaurantId || '').trim();
    const restaurantName = (data.restaurantName || '').trim() || restaurantId;
    const periodYears = data.periodYears || 1;
    const customDateStr = data.customDateStr || null;
    const action = data.action || 'RENEWED';

    if (!restaurantId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Missing restaurantId parameter.'
        );
    }

    const now = new Date();
    let targetExp = new Date(now.getTime());

    if (periodYears === 'custom' && customDateStr) {
        targetExp = new Date(customDateStr + 'T23:59:59');
    } else {
        const yrs = parseInt(periodYears, 10) || 1;
        targetExp.setFullYear(now.getFullYear() + yrs);
    }

    const subRef = db.collection('subscriptions').doc(restaurantId);
    const existingSnap = await subRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : null;

    const payload = {
        restaurantId: restaurantId,
        restaurantName: restaurantName,
        status: 'active',
        periodYears: periodYears,
        activatedAt: (existingData && existingData.activatedAt) ? existingData.activatedAt : admin.firestore.Timestamp.fromDate(now),
        lastRenewedAt: admin.firestore.Timestamp.fromDate(now),
        expiresAt: admin.firestore.Timestamp.fromDate(targetExp),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: context.auth.token.email || 'SmartServe Super Admin'
    };

    await subRef.set(payload, { merge: true });

    // Write audit log
    await db.collection('subscription_audit_logs').add({
        restaurantId: restaurantId,
        action: action,
        previousExpiry: existingData && existingData.expiresAt ? String(existingData.expiresAt) : 'None',
        newExpiry: targetExp.toISOString(),
        adminEmail: context.auth.token.email || 'unknown',
        adminUid: context.auth.uid,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
        success: true,
        restaurantId: restaurantId,
        expiresAt: targetExp.toISOString()
    };
});
