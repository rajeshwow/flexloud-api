import { PoolClient } from "pg";
import { db } from "./pool";

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
