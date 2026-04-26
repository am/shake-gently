import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const workerPath = new URL('./src/worker.ts', import.meta.url);
const wranglerPath = new URL('./wrangler.jsonc', import.meta.url);
const packagePath = new URL('./package.json', import.meta.url);

assert.equal(existsSync(workerPath), true, 'src/worker.ts should define the Cloudflare backend');
assert.equal(existsSync(wranglerPath), true, 'wrangler.jsonc should configure Cloudflare deployment');

const workerSource = readFileSync(workerPath, 'utf8');
const wranglerConfig = readFileSync(wranglerPath, 'utf8');
const wranglerJson = JSON.parse(wranglerConfig);
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

assert.match(workerSource, /export class RoomDurableObject/, 'Worker should export the room Durable Object class');
assert.match(workerSource, /MSG_SYNC\s*=\s*0/, 'Worker should use y-websocket sync message type 0');
assert.match(workerSource, /MSG_AWARENESS\s*=\s*1/, 'Worker should use y-websocket awareness message type 1');
assert.match(workerSource, /readSyncMessage/, 'Worker should read Yjs sync messages');
assert.match(workerSource, /applyAwarenessUpdate/, 'Worker should apply awareness updates');
assert.match(workerSource, /acceptWebSocket/, 'Worker should use the Hibernatable WebSocket API');
assert.match(workerSource, /getByName\(roomName\)/, 'Worker should route each room path to a named Durable Object');
assert.match(workerSource, /Upgrade'\)\s*!==\s*'websocket'/, 'Worker should guard non-WebSocket room requests');

assert.equal(wranglerJson.main, 'src/worker.ts', 'Wrangler should point at src/worker.ts');
assert.equal(wranglerJson.compatibility_date, '2026-04-26', 'Wrangler should use the requested compatibility date');
assert.ok(wranglerJson.compatibility_flags.includes('nodejs_compat'), 'Wrangler should enable nodejs_compat');
assert.equal(wranglerJson.assets.directory, './dist', 'Wrangler should serve static assets from dist');
assert.equal(wranglerJson.assets.not_found_handling, 'single-page-application', 'Wrangler should enable SPA fallback');
assert.ok(wranglerJson.assets.run_worker_first.includes('/shake-gently-room'), 'WebSocket room paths should reach the Worker before assets');
assert.equal(wranglerJson.durable_objects.bindings[0].name, 'ROOMS', 'Wrangler should bind the Durable Object namespace as ROOMS');
assert.equal(wranglerJson.durable_objects.bindings[0].class_name, 'RoomDurableObject', 'Wrangler should bind RoomDurableObject');
assert.deepEqual(wranglerJson.migrations[0].new_sqlite_classes, ['RoomDurableObject'], 'Wrangler should use SQLite Durable Object migrations');
assert.equal(wranglerJson.observability.enabled, true, 'Wrangler should enable observability');

const mainSource = readFileSync(new URL('./src/main.ts', import.meta.url), 'utf8');
assert.match(mainSource, /window\.location/, 'Client should derive WS URL from page origin for deployed environments');

assert.equal(packageJson.scripts['test:cf-config'], 'node test-cf-config.mjs', 'package.json should expose test:cf-config');
assert.match(packageJson.scripts.server, /wrangler dev/, 'server script should use wrangler dev');
assert.equal(packageJson.scripts.deploy, 'wrangler deploy', 'package.json should expose deploy');
assert.equal(packageJson.scripts['deploy:dry-run'], 'wrangler deploy --dry-run', 'package.json should expose dry-run deploy');
assert.ok(packageJson.devDependencies?.wrangler, 'package.json should include wrangler as a devDependency');

console.log('Cloudflare deployment invariants verified');
