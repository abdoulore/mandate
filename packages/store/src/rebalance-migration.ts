export const rebalanceMigration=[
 'CREATE TABLE research_rebalances(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),request_id text NOT NULL,mandate_revision integer NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(account_id,request_id),FOREIGN KEY(account_id,mandate_revision) REFERENCES investment_mandates(account_id,revision))',
 'CREATE INDEX research_rebalances_history ON research_rebalances(account_id,created_at DESC,id)',
 'INSERT INTO mandate_schema(version) VALUES(4)',
];
