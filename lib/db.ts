import mysql from "mysql2/promise";

function getConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error("Неверный формат DATABASE_URL");
  const [, user, password, host, port, database] = m;
  return {
    host,
    port: parseInt(port, 10),
    user,
    password,
    database,
  };
}

export async function getConnection() {
  return mysql.createConnection(getConfig());
}
