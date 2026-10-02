export const planControlMigration = [
  `CREATE TABLE plan_controls(
    plan_id text PRIMARY KEY REFERENCES plans(id),
    account_id text NOT NULL REFERENCES accounts(id),
    status text NOT NULL CHECK(status IN ('active','paused','cancellation_requested','revoked')),
    revision integer NOT NULL CHECK(revision>0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp())`,
  `INSERT INTO plan_controls(plan_id,account_id,status,revision)
    SELECT id,account_id,'active',1 FROM plans ON CONFLICT(plan_id) DO NOTHING`,
  'INSERT INTO mandate_schema(version) VALUES(8)',
];
