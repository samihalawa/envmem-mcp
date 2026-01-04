-- Projects table for organizing env variables by project/repo
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  name TEXT NOT NULL,
  repo_url TEXT,
  tags TEXT, -- JSON array of tags
  description TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Composite unique constraint: one project name per user
CREATE UNIQUE INDEX idx_project_user_name ON projects(user_id, name);
CREATE INDEX idx_project_user_id ON projects(user_id);
CREATE INDEX idx_project_repo ON projects(repo_url);

-- Link table between env_variables and projects
-- Supports different values per environment (dev/staging/prod)
CREATE TABLE IF NOT EXISTS env_project_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  env_variable_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  environment TEXT DEFAULT 'default', -- 'dev', 'staging', 'prod', 'default'
  value_override TEXT, -- Optional different value for this project/env combo
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (env_variable_id) REFERENCES env_variables(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Composite unique: one link per env+project+environment combo
CREATE UNIQUE INDEX idx_link_env_project_env ON env_project_links(env_variable_id, project_id, environment);
CREATE INDEX idx_link_project ON env_project_links(project_id);
CREATE INDEX idx_link_env ON env_project_links(env_variable_id);
