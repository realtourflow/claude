ALTER TABLE tasks
  ADD COLUMN priority      VARCHAR(10) NOT NULL DEFAULT 'medium',
  ADD COLUMN source        VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN stage_context VARCHAR(50),
  ADD COLUMN role          VARCHAR(30) NOT NULL DEFAULT 'agent';
