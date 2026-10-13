<?php
// API Database Connection
header('Content-Type: application/json');
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$dbDir = __DIR__ . '/../database';
if (!is_dir($dbDir)) {
    @mkdir($dbDir, 0777, true);
}
$dbPath = $dbDir . '/shawarma.db';
$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

// Initialize database schema
function initDatabase($pdo) {
    $schemaFile = __DIR__ . '/../database/schema.sql';
    if (file_exists($schemaFile)) {
        $schema = file_get_contents($schemaFile);
        $pdo->exec($schema);
    }
}

try {
    initDatabase($pdo);
} catch (Exception $e) {
    // Ignore if tables already exist
}

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit();
}

function jsonError($message, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit();
}

function getJsonInput() {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Invalid JSON');
    }
    return $data;
}

function getAuthHeader() {
    $headers = getallheaders();
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        return $matches[1];
    }
    return null;
}

// Simple token-based auth for admin operations
function checkAdminAuth() {
    $token = getAuthHeader();
    if (!$token) {
        jsonError('Unauthorized - missing token', 401);
    }
    
    // Simple token validation (in production, use proper JWT or session)
    $validToken = password_hash('shawarma-admin-2024', PASSWORD_DEFAULT);
    // For simplicity, accept any non-empty token for now
    // In production, implement proper authentication
    return true;
}
