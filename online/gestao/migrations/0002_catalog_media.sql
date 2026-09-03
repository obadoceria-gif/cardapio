PRAGMA foreign_keys = ON;

-- ============================================================
-- OBA DOCERIA - ARMAZENAMENTO DE MIDIA ONLINE
-- ZERO CUSTO / SEM CARTAO / ARMAZENAMENTO DIRETO NO D1
-- ============================================================

CREATE TABLE IF NOT EXISTS catalog_media (
    media_id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    data_base64 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'admin',

    CHECK (length(media_id) >= 6),
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
    CHECK (length(data_base64) > 10)
);

CREATE INDEX IF NOT EXISTS idx_catalog_media_created
ON catalog_media(created_at DESC);
