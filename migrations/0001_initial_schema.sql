-- Environment variables metadata table
CREATE TABLE IF NOT EXISTS env_variables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  service TEXT NOT NULL,
  required INTEGER DEFAULT 0, -- SQLite uses 0/1 for boolean
  example TEXT,
  keywords TEXT, -- JSON array stored as text
  related_to TEXT, -- JSON array stored as text
  vector_id TEXT, -- Reference to Vectorize ID
  indexed_at INTEGER, -- When vector was created
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexing status tracking table
CREATE TABLE IF NOT EXISTS indexing_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  env_variable_id INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'queued', 'processing', 'indexed', 'failed'
  queue_timestamp INTEGER,
  indexed_timestamp INTEGER,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  FOREIGN KEY (env_variable_id) REFERENCES env_variables(id)
);

-- Search analytics table
CREATE TABLE IF NOT EXISTS search_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  result_count INTEGER,
  top_result_id INTEGER,
  timestamp INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (top_result_id) REFERENCES env_variables(id)
);

-- Indexes for fast lookups
CREATE INDEX idx_env_name ON env_variables(name);
CREATE INDEX idx_env_category ON env_variables(category);
CREATE INDEX idx_env_service ON env_variables(service);
CREATE INDEX idx_env_required ON env_variables(required);
CREATE INDEX idx_env_vector_id ON env_variables(vector_id);
CREATE INDEX idx_indexing_status ON indexing_status(status);
CREATE INDEX idx_search_timestamp ON search_analytics(timestamp);

-- Full-text search for keyword matching
CREATE VIRTUAL TABLE env_fts USING fts5(
  name,
  description,
  category,
  service,
  keywords,
  content='env_variables',
  content_rowid='id'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER env_fts_insert AFTER INSERT ON env_variables BEGIN
  INSERT INTO env_fts(rowid, name, description, category, service, keywords)
  VALUES (new.id, new.name, new.description, new.category, new.service, new.keywords);
END;

CREATE TRIGGER env_fts_delete AFTER DELETE ON env_variables BEGIN
  DELETE FROM env_fts WHERE rowid = old.id;
END;

CREATE TRIGGER env_fts_update AFTER UPDATE ON env_variables BEGIN
  DELETE FROM env_fts WHERE rowid = old.id;
  INSERT INTO env_fts(rowid, name, description, category, service, keywords)
  VALUES (new.id, new.name, new.description, new.category, new.service, new.keywords);
END;
