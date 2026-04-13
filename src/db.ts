export interface CertRecord {
  id:          number;
  site_id:     string;
  name:        string;
  achievement: string;
  r2_key:      string;
  serial:      string;
  email:       string | null;
  created_at:  string;
}

export async function hasRecentCertificate(
  db:     D1Database,
  siteId: string,
  email:  string,
): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT 1 FROM certificates WHERE site_id = ? AND email = ? AND date(created_at) = date(\'now\') LIMIT 1',
    )
    .bind(siteId, email)
    .first<{ 1: number }>();
  return row !== null;
}

export async function findCertificate(
  db:    D1Database,
  r2Key: string,
): Promise<CertRecord | null> {
  return db
    .prepare('SELECT * FROM certificates WHERE r2_key = ?')
    .bind(r2Key)
    .first<CertRecord>();
}

export async function insertCertificate(
  db:          D1Database,
  siteId:      string,
  name:        string,
  achievement: string,
  r2Key:       string,
  email:       string | null,
): Promise<string> {
  const row = await db
    .prepare(
      'INSERT INTO certificates (site_id, name, achievement, r2_key, serial, email) ' +
      "VALUES (?, ?, ?, ?, '', ?) RETURNING id",
    )
    .bind(siteId, name, achievement, r2Key, email)
    .first<{ id: number }>();

  if (!row) throw new Error('parchment: D1 insert returned no row');

  const serial = `${siteId.toUpperCase()}-${String(row.id).padStart(4, '0')}`;

  await db
    .prepare('UPDATE certificates SET serial = ? WHERE id = ?')
    .bind(serial, row.id)
    .run();

  return serial;
}
