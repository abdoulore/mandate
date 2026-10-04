export const directTrialMandateMigration=[
 'CREATE TABLE direct_trial_mandates(account_id text NOT NULL REFERENCES accounts(id),revision integer NOT NULL CHECK(revision>0),id text NOT NULL UNIQUE,record jsonb NOT NULL,PRIMARY KEY(account_id,revision))',
 'INSERT INTO mandate_schema(version) VALUES(10)',
];
