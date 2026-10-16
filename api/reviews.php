<?php
require_once 'db.php';

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$segments = explode('/', trim($path, '/'));

$id = null;
if (isset($segments[2]) && $segments[2] === 'reviews') {
    $id = $segments[3] ?? null;
}

if ($method === 'GET') {
    if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM reviews WHERE id = ?');
        $stmt->execute([$id]);
        $review = $stmt->fetch();
        if (!$review) {
            jsonError('Review not found', 404);
        }
        $review['tags'] = json_decode($review['tags'] ?? '[]', true);
        jsonResponse($review);
    } else {
        $category = $_GET['category'] ?? null;
        $sql = 'SELECT * FROM reviews';
        $params = [];
        if ($category && $category !== 'all') {
            $sql .= ' WHERE category = ?';
            $params[] = $category;
        }
        $sql .= ' ORDER BY created_at DESC LIMIT 100';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $reviews = $stmt->fetchAll();
        foreach ($reviews as &$r) {
            $r['tags'] = json_decode($r['tags'] ?? '[]', true);
        }
        jsonResponse($reviews);
    }
}

if ($method === 'POST') {
    $data = getJsonInput();
    $id = $data['id'] ?? uniqid('rev_');
    $author = trim($data['author'] ?? '');
    if (!$author) $author = 'میوان • Guest';
    $rating = intval($data['rating'] ?? 5);
    if ($rating < 1) $rating = 1;
    if ($rating > 5) $rating = 5;
    $category = $data['category'] ?? 'all';
    $tags = json_encode($data['tags'] ?? []);
    $comment = trim($data['comment'] ?? '');
    $tableNum = trim($data['table'] ?? '');
    
    $stmt = $pdo->prepare('INSERT INTO reviews (id, author, rating, category, tags, comment, table_num, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'active\', datetime(\'now\'))');
    $stmt->execute([$id, $author, $rating, $category, $tags, $comment, $tableNum]);
    
    jsonResponse([
        'success' => true,
        'id' => $id,
        'message' => 'Review submitted successfully'
    ]);
}

if ($method === 'DELETE') {
    if (!$id) {
        $data = getJsonInput();
        $id = $data['id'] ?? null;
    }
    if (!$id) {
        jsonError('Review ID is required', 400);
    }
    
    $stmt = $pdo->prepare('DELETE FROM reviews WHERE id = ?');
    $stmt->execute([$id]);
    jsonResponse(['success' => true]);
}

jsonError('Method not allowed', 405);
