/**
 * SmartServe Super Admin Role Provisioning Script
 * 
 * Sets the `superadmin: true` custom claim on a designated Firebase Auth user.
 * Custom claims cannot be set or modified by frontend JavaScript.
 * 
 * Usage:
 *   1. Download your Firebase service account private key from:
 *      Firebase Console -> Project Settings -> Service accounts -> "Generate new private key"
 *   2. Save the downloaded JSON file as `serviceAccountKey.json` in the project root or specify via env:
 *      GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
 *   3. Run:
 *      node scripts/set-superadmin.js <email>
 *      Example:
 *      node scripts/set-superadmin.js superadmin@smartserve.com
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const targetEmail = process.argv[2];

if (!targetEmail) {
    console.error('❌ Error: Missing target email.');
    console.error('Usage: node scripts/set-superadmin.js <email-address>');
    process.exit(1);
}

// Find service account key
const possiblePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(__dirname, '..', 'serviceAccountKey.json'),
    path.join(__dirname, 'serviceAccountKey.json')
].filter(Boolean);

let serviceAccountPath = possiblePaths.find(p => fs.existsSync(p));

if (!serviceAccountPath) {
    console.error('❌ Error: serviceAccountKey.json not found!');
    console.error('\nTo obtain your Service Account Key:');
    console.error('  1. Open Firebase Console (https://console.firebase.google.com/)');
    console.error('  2. Select project: brew-coffee-1cd84');
    console.error('  3. Click Project Settings (gear icon) -> Service accounts');
    console.error('  4. Click "Generate new private key"');
    console.error('  5. Save the file as "serviceAccountKey.json" in this project folder.\n');
    process.exit(1);
}

const serviceAccount = require(path.resolve(serviceAccountPath));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

console.log(`🔍 Looking up user: ${targetEmail}...`);

admin.auth().getUserByEmail(targetEmail)
    .then(user => {
        console.log(`✅ Found user UID: ${user.uid} (${user.email})`);
        
        // Assign custom claims
        return admin.auth().setCustomUserClaims(user.uid, {
            superadmin: true,
            admin: true,
            role: 'superadmin',
            grantedAt: new Date().toISOString()
        }).then(() => {
            console.log(`\n🎉 SUCCESS! Custom claim 'superadmin: true' assigned to: ${targetEmail}`);
            console.log('The user can now sign in at smartserve-admin.html with full Super Admin privileges.\n');
            process.exit(0);
        });
    })
    .catch(error => {
        if (error.code === 'auth/user-not-found') {
            console.error(`❌ User not found with email: ${targetEmail}`);
            console.error('Please create this user first in Firebase Console -> Authentication -> Users, or sign up via login.');
        } else {
            console.error('❌ Firebase Admin error:', error.message || error);
        }
        process.exit(1);
    });
