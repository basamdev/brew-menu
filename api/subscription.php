<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $rId = trim($_GET['id'] ?? $_GET['restaurantId'] ?? 'brew-coffee');
    if ($rId === '') {
        $rId = 'brew-coffee';
    }

    try {
        $stmt = $pdo->prepare('SELECT * FROM subscriptions WHERE id = ?');
        $stmt->execute([$rId]);
        $row = $stmt->fetch();

        if (!$row) {
            jsonResponse([
                'id' => $rId,
                'restaurantId' => $rId,
                'status' => 'active',
                'unregistered' => true
            ]);
        }

        $decodedData = [];
        if (!empty($row['data'])) {
            $decodedData = json_decode($row['data'], true) ?: [];
        }

        $response = array_merge([
            'id' => $row['id'],
            'restaurantId' => $row['id'],
            'restaurantName' => $row['restaurant_name'] ?? '',
            'status' => $row['status'] ?? 'active',
            'activatedAt' => $row['activated_at'] ?? '',
            'expiresAt' => $row['expires_at'] ?? '',
            'lastRenewedAt' => $row['last_renewed_at'] ?? '',
            'periodYears' => (int)($row['period_years'] ?? 1),
            'updatedAt' => $row['updated_at'] ?? ''
        ], $decodedData);

        jsonResponse($response);
    } catch (Exception $e) {
        jsonResponse([
            'id' => $rId,
            'restaurantId' => $rId,
            'status' => 'active',
            'error' => $e->getMessage()
        ]);
    }
}

if ($method === 'POST' || $method === 'PUT') {
    $data = getJsonInput();
    $rId = trim($data['id'] ?? $data['restaurantId'] ?? 'brew-coffee');
    if ($rId === '') {
        $rId = 'brew-coffee';
    }

    $restaurantName = trim($data['restaurantName'] ?? 'Brew Cafe & Rest');
    $status = trim($data['status'] ?? 'active');
    $activatedAt = trim($data['activatedAt'] ?? date('c'));
    $expiresAt = trim($data['expiresAt'] ?? date('c', strtotime('+1 year')));
    $lastRenewedAt = trim($data['lastRenewedAt'] ?? date('c'));
    $periodYears = (int)($data['periodYears'] ?? 1);
    $jsonData = json_encode($data);

    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            restaurant_name TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            activated_at TEXT DEFAULT '',
            expires_at TEXT DEFAULT '',
            last_renewed_at TEXT DEFAULT '',
            period_years INTEGER DEFAULT 1,
            data TEXT DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now'))
        )");

        $stmt = $pdo->prepare('INSERT OR REPLACE INTO subscriptions 
            (id, restaurant_name, status, activated_at, expires_at, last_renewed_at, period_years, data, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))');
        $stmt->execute([
            $rId,
            $restaurantName,
            $status,
            $activatedAt,
            $expiresAt,
            $lastRenewedAt,
            $periodYears,
            $jsonData
        ]);

        jsonResponse([
            'success' => true,
            'id' => $rId,
            'status' => $status,
            'expiresAt' => $expiresAt
        ]);
    } catch (Exception $e) {
        jsonError($e->getMessage(), 500);
    }
}

jsonError('Method not allowed', 405);
