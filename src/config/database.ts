import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("connect", async (client) => {
  console.log("✅ Conectado a PostgreSQL (Neon)");

  const schema = process.env.DB_SCHEMA || "public";
  await client.query(`SET search_path TO ${schema}, public`);
  console.log(`📂 Esquema activo: ${schema}`);
});

pool.on("error", (err) => {
  console.error("❌ Error en conexión a PostgreSQL:", err);
  process.exit(-1);
});

export const testConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();

    const result = await client.query("SELECT NOW()");
    console.log("🔗 Conexión a BD verificada:", result.rows[0].now);

    const schemaCheck = await client.query("SHOW search_path");
    console.log("📦 Esquema actual:", schemaCheck.rows[0].search_path);

    client.release();
    return true;
  } catch (error) {
    console.error("❌ Error al conectar con la base de datos:", error);
    return false;
  }
};

export default pool;
