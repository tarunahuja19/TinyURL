CREATE TABLE IF NOT EXISTS url.URL(
    ID          BIGINT    PRIMARY KEY,
    OriginalURL TEXT      NOT NULL,
    ShortURL    TEXT      NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW(),
    expires_at  TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_short_url ON url.URL (ShortURL);

CREATE TABLE IF NOT EXISTS url.click_analytics (
    id         BIGSERIAL PRIMARY KEY,
    short_key  TEXT NOT NULL,
    ip         TEXT,
    country    VARCHAR(10),
    region     VARCHAR(100),
    city       VARCHAR(100),
    user_agent TEXT,
    referrer   TEXT,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_click_analytics_short_key ON url.click_analytics (short_key);
CREATE INDEX IF NOT EXISTS idx_click_analytics_clicked_at ON url.click_analytics (clicked_at);