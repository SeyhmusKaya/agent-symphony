-- CodeGraph SQLite schema
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  language TEXT NOT NULL,
  size INTEGER,
  mtime INTEGER,
  hash TEXT,
  indexed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_files_lang ON files(language);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_col INTEGER,
  end_col INTEGER,
  signature TEXT,
  doc TEXT,
  is_exported INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_qname ON symbols(qualified_name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY,
  src_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  dst_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  dst_unresolved TEXT,
  kind TEXT NOT NULL,
  src_line INTEGER NOT NULL,
  src_col INTEGER
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_symbol_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_symbol_id);
CREATE INDEX IF NOT EXISTS idx_edges_unresolved ON edges(dst_unresolved) WHERE dst_unresolved IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name, qualified_name, signature, doc,
  content='symbols', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, qualified_name, signature, doc)
  VALUES (new.id, new.name, new.qualified_name, new.signature, new.doc);
END;
CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, qualified_name, signature, doc)
  VALUES('delete', old.id, old.name, old.qualified_name, old.signature, old.doc);
END;
CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, qualified_name, signature, doc)
  VALUES('delete', old.id, old.name, old.qualified_name, old.signature, old.doc);
  INSERT INTO symbols_fts(rowid, name, qualified_name, signature, doc)
  VALUES (new.id, new.name, new.qualified_name, new.signature, new.doc);
END;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Fix 92: docs index (md/json/yaml/toml/txt). Tree-sitter degil; regex/JSON.parse
-- ile satir-bazli chunk olusturulur. Sembol modeli ile karistirma — ayri tablo.
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  doc_type TEXT NOT NULL,
  size INTEGER,
  mtime INTEGER,
  hash TEXT,
  indexed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_docs_type ON docs(doc_type);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  chunk_kind TEXT NOT NULL,
  title TEXT,
  level INTEGER DEFAULT 0,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  body TEXT
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON doc_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_kind ON doc_chunks(chunk_kind);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
  title, body,
  content='doc_chunks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(rowid, title, body)
  VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, title, body)
  VALUES('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS doc_chunks_au AFTER UPDATE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, title, body)
  VALUES('delete', old.id, old.title, old.body);
  INSERT INTO doc_chunks_fts(rowid, title, body)
  VALUES (new.id, new.title, new.body);
END;
