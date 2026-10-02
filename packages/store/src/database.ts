import {PGlite} from '@electric-sql/pglite';
import {Pool} from 'pg';

export interface Queryable { query<T extends Record<string,any> = Record<string,any>>(sql:string,params?:any[]):Promise<{rows:T[]}> }
export interface Database extends Queryable {transaction<T>(fn:(tx:Queryable)=>Promise<T>):Promise<T>;close():Promise<void>}
export function embeddedDatabase(path?:string):Database {
  const db=new PGlite(path);
  return {query:(sql,params)=>db.query(sql,params),transaction:fn=>db.transaction(tx=>fn(tx)),close:()=>db.close()};
}
export function postgresDatabase(connectionString:string):Database {
  const pool=new Pool({connectionString});
  return {query:async(sql,params)=>pool.query(sql,params),close:()=>pool.end(),transaction:async fn=>{
    const client=await pool.connect();
    try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }};
}

// Whole token quantities stay as strings at the SQL boundary. Never parse NUMERIC into JS Number.
export const migration = `
CREATE TABLE IF NOT EXISTS mandate_schema(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS accounts(
 id text PRIMARY KEY, record jsonb NOT NULL,
 balance numeric(78,0) NOT NULL CHECK(balance>=0),
 protected numeric(78,0) NOT NULL CHECK(protected>=0 AND protected<=balance),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0));
CREATE TABLE IF NOT EXISTS plans(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS reservations(
 id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),plan_id text NOT NULL UNIQUE REFERENCES plans(id),
 idempotency_key text NOT NULL,amount numeric(78,0) NOT NULL CHECK(amount>0),
 state text NOT NULL CHECK(state IN ('held','released','consumed')),record jsonb NOT NULL,
 UNIQUE(account_id,idempotency_key));
CREATE TABLE IF NOT EXISTS receipts(id text PRIMARY KEY,reservation_id text NOT NULL UNIQUE REFERENCES reservations(id),account_id text NOT NULL REFERENCES accounts(id),transaction_hash text NOT NULL,record jsonb NOT NULL,UNIQUE(account_id,transaction_hash));
CREATE TABLE IF NOT EXISTS submission_barriers(reservation_id text PRIMARY KEY REFERENCES reservations(id),request_id text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS journal(id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),kind text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS outbox(
 id text PRIMARY KEY REFERENCES journal(id),payload jsonb NOT NULL,lease_token text,lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,done boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS reservations_held ON reservations(account_id) WHERE state='held';
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(done,lease_until);
INSERT INTO mandate_schema(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
