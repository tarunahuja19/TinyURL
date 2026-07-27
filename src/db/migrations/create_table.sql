CREATE TABLE IF NOT EXISTS url.URL(
    ID UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    OriginalURL TEXT NOT NULL ,
    ShortURL TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_short_url ON url.URL (ShortURL);