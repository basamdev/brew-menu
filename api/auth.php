<?php
require_once 'db.php';

// CORS: echo the requesting origin and allow credentials so the browser will
// send back the PHP session cookie. Using a fixed "*" here would block
// credentialed requests and break auth when the frontend and API are served
// from the same origin but accessed via a different host/port.
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '*';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS, DELETE');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

session_start();

// Admin credentials
$validAdmins = [
    'brew@gmail.com' => 'brew111222333',
    'admin@brew.com' => 'admin123',
    'admin@coffee.com' => 'admin123',
    'admin@shawarma.com' => 'admin123',
    'admin@admin.com' => 'admin123'
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = getJsonInput();
    $email = strtolower(trim($data['email'] ?? ''));
    $password = $data['password'] ?? '';
    
    if (isset($validAdmins[$email]) && $validAdmins[$email] === $password) {
        $_SESSION['admin_logged_in'] = true;
        $_SESSION['admin_email'] = $email;
        
        jsonResponse([
            'success' => true,
            'token' => bin2hex(random_bytes(32)),
            'user' => ['email' => $email]
        ]);
    } else {
        jsonError('Invalid credentials', 401);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in']) {
        jsonResponse([
            'authenticated' => true,
            'user' => ['email' => $_SESSION['admin_email']]
        ]);
    } else {
        jsonResponse(['authenticated' => false], 401);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    session_destroy();
    jsonResponse(['success' => true]);
}

jsonError('Method not allowed', 405);
