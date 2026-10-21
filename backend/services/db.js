import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://credpass:credpass@localhost:5432/credpass';

let pool = null;

export function getPool() {
    if (!pool) {
        pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30000 });
    }
    return pool;
}

export async function connectDB() {
    return getPool();
}

export async function healthDB() {
    try {
        const client = await getPool().connect();
        await client.query('SELECT 1');
        client.release();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
