/**
 * SmartServe Super Admin Role Provisioning Script (Zero-Dependency)
 * 
 * Sets the dedicated `superadmin: true` custom claim on a Firebase Auth user
 * using Google Identity Toolkit API & serviceAccountKey.json.
 * 
 * Usage:
 *   node scripts/set-superadmin.js <email>
 *   Example:
 *   node scripts/set-superadmin.js superadmin@smartserve.iq
 */

const crypto = require('crypto');
const https = require('https');
const path = require('path');
const fs = require('fs');

const targetEmail = (process.argv[2] || '').trim().toLowerCase();

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
    console.error('❌ Error: serviceAccountKey.json not found in project folder!');
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(serviceAccountPath), 'utf8'));
const projectId = serviceAccount.project_id || 'brew-coffee-1cd84';

function getGoogleAccessToken() {
    return new Promise((resolve, reject) => {
        const now = Math.floor(Date.now() / 1000);
        const header = { alg: 'RS256', typ: 'JWT' };
        const claimSet = {
            iss: serviceAccount.client_email,
            scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        };

        const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
        const unsignedToken = `${b64(header)}.${b64(claimSet)}`;

        const sign = crypto.createSign('RSA-SHA256');
        sign.update(unsignedToken);
        const signature = sign.sign(serviceAccount.private_key, 'base64url');
        const jwt = `${unsignedToken}.${signature}`;

        const postData = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
                         '&assertion=' + encodeURIComponent(jwt);

        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.access_token) {
                        resolve(data.access_token);
                    } else {
                        reject(new Error(data.error_description || body));
                    }
                } catch (e) {
                    reject(new Error('Invalid token response: ' + body));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function httpsJsonRequest(url, method, token, bodyData) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const postBody = bodyData ? JSON.stringify(bodyData) : null;
        const headers = {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        };
        if (postBody) {
            headers['Content-Length'] = Buffer.byteLength(postBody);
        }

        const req = https.request({
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: method,
            headers: headers
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject(new Error(json.error && json.error.message ? json.error.message : body));
                    }
                } catch (e) {
                    reject(new Error('Invalid JSON response: ' + body));
                }
            });
        });

        req.on('error', reject);
        if (postBody) req.write(postBody);
        req.end();
    });
}

async function main() {
    console.log(`🔍 Authenticating with Google Cloud IAM for project: ${projectId}...`);
    const accessToken = await getGoogleAccessToken();
    console.log(`✅ Authenticated with Service Account: ${serviceAccount.client_email}`);

    console.log(`🔍 Looking up user by email: ${targetEmail}...`);
    const lookupUrl = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`;
    const lookupRes = await httpsJsonRequest(lookupUrl, 'POST', accessToken, {
        email: [targetEmail]
    });

    if (!lookupRes.users || !lookupRes.users.length) {
        console.error(`❌ User not found with email: ${targetEmail}`);
        console.error('Please verify that the user exists in Firebase Console -> Authentication -> Users.');
        process.exit(1);
    }

    const user = lookupRes.users[0];
    const uid = user.localId;
    console.log(`✅ Found User UID: ${uid} (${user.email})`);

    const customClaims = {
        superadmin: true,
        role: 'superadmin',
        grantedAt: new Date().toISOString()
    };

    console.log(`⚙️  Assigning dedicated claim: { superadmin: true }...`);
    const updateUrl = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`;
    await httpsJsonRequest(updateUrl, 'POST', accessToken, {
        localId: uid,
        customAttributes: JSON.stringify(customClaims)
    });

    console.log(`\n🎉 SUCCESS! Custom claim 'superadmin: true' assigned to: ${targetEmail}`);
    console.log(`\nUser Details:`);
    console.log(`  • Email:  ${targetEmail}`);
    console.log(`  • UID:    ${uid}`);
    console.log(`  • Claims: ${JSON.stringify(customClaims)}`);
    console.log(`\nYou can now sign in at smartserve-admin.html with full Super Admin privileges.\n`);
}

main().catch(err => {
    console.error('❌ Error assigning Super Admin claim:', err.message || err);
    process.exit(1);
});
