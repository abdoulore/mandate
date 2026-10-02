export const inflowMigration=[
 'CREATE TABLE inflow_reviews(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),transaction_hash text NOT NULL,revision integer NOT NULL CHECK(revision>0),record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(account_id,transaction_hash,revision))',
 'CREATE INDEX inflow_review_history ON inflow_reviews(account_id,created_at DESC,id)',
 'CREATE TABLE inflow_proposal_links(account_id text NOT NULL REFERENCES accounts(id),transaction_hash text NOT NULL,proposal_id text NOT NULL UNIQUE REFERENCES research_proposals(id),event_id text NOT NULL REFERENCES inflow_reviews(id),PRIMARY KEY(account_id,transaction_hash))',
 'INSERT INTO mandate_schema(version) VALUES(6)',
];
