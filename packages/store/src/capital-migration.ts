// Migration 2 is additive except for removing the obsolete protection<=balance
// constraint: external wallet activity can make an account underfunded.
export const capitalMigration=[
 'CREATE TABLE capital_checkpoints(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),block_number numeric(78,0) NOT NULL,block_hash text NOT NULL,record jsonb NOT NULL,UNIQUE(account_id,block_hash))',
 'CREATE TABLE capital_policies(account_id text NOT NULL REFERENCES accounts(id),revision integer NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,revision))',
 'CREATE TABLE capital_heads(account_id text PRIMARY KEY REFERENCES accounts(id),checkpoint_id text NOT NULL REFERENCES capital_checkpoints(id))',
 'CREATE TABLE capital_health(account_id text PRIMARY KEY REFERENCES accounts(id),state text NOT NULL)',
 'ALTER TABLE accounts ADD CONSTRAINT accounts_protected_nonnegative CHECK(protected>=0)',
 'INSERT INTO mandate_schema(version) VALUES(2)',
];
