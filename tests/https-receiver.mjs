// Test-only HTTPS wrapper around the receiver, so the publisher can be
// exercised end to end with its HTTPS-only curl settings.
// Usage: node tests/https-receiver.mjs <key.pem> <cert.pem> <data-dir> <port-file>
// Reads NOW_PLAYING_WRITE_SECRET from the environment.
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { createHandler, createRequestListener } from "../receiver/server.mjs";

const [keyPath, certPath, dataDirectory, portFile] = process.argv.slice(2);
const handler = await createHandler({
  dataDirectory,
  secret: process.env.NOW_PLAYING_WRITE_SECRET,
  logger: { error() {} },
});
const server = createServer(
  { key: await readFile(keyPath), cert: await readFile(certPath) },
  createRequestListener(handler),
);
server.listen(0, "127.0.0.1", async () => {
  await writeFile(portFile, String(server.address().port));
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
