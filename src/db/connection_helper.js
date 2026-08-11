/**
 * Safely parses and percent-encodes passwords in Postgres connection strings
 * if they contain special characters like '@'.
 */
export function parseConnectionString(connStr) {
  if (!connStr) return connStr;
  const match = connStr.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@\/]+)(:\d+)?\/(.+)$/);
  if (match) {
    const [, user, pass, host, port = '', db] = match;
    const encodedPass = encodeURIComponent(decodeURIComponent(pass));
    return `postgres://${user}:${encodedPass}@${host}${port}/${db}`;
  }
  return connStr;
}
