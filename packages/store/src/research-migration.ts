// Research records cannot be submitted or reserved through these tables.
export const researchMigration=[
 'CREATE TABLE investment_mandates(account_id text NOT NULL REFERENCES accounts(id),revision integer NOT NULL CHECK(revision>0),id text NOT NULL UNIQUE,record jsonb NOT NULL,PRIMARY KEY(account_id,revision))',
 'CREATE TABLE research_proposals(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),request_id text NOT NULL,mandate_revision integer NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(account_id,request_id),FOREIGN KEY(account_id,mandate_revision) REFERENCES investment_mandates(account_id,revision))',
 'CREATE INDEX research_proposals_history ON research_proposals(account_id,created_at DESC,id)',
 'INSERT INTO mandate_schema(version) VALUES(3)',
];
