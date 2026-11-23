-- Persist create-request identity so a retry after a lost response reopens the same evaluation.
ALTER TABLE evaluations ADD COLUMN request_id TEXT;
ALTER TABLE evaluations ADD COLUMN request_fingerprint TEXT;
CREATE UNIQUE INDEX idx_evaluations_request_id ON evaluations(request_id)
WHERE request_id IS NOT NULL;
