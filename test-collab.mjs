/**
 * Integration test: verifies the 5 collaboration conditions with 3 simulated users.
 *
 * Prerequisites: wrangler dev must be running on ws://localhost:8787
 *
 * Conditions tested:
 *   1. Multiple users connect to a shared input field
 *   2. Each user has its own caret (independent awareness state)
 *   3. Each caret has a unique color among users
 *   4. Each user's typed text is stored with that user's color
 *   5. Each user sees other users' carets with the correct user color
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const WS_URL = 'ws://localhost:8787';
const ROOM = `shake-gently-room/test-${Date.now()}`;
const USER_COUNT = 3;

const SHADES = [
  { name: 'Moonstone',     color: '#90b8f8' },
  { name: 'Pearl Dust',    color: '#f090c0' },
  { name: 'Frost Whisper', color: '#70d0f0' },
  { name: 'Silver Dawn',   color: '#c0c0c0' },
  { name: 'Ghost Orchid',  color: '#c090f0' },
  { name: 'Bone Light',    color: '#f0d080' },
  { name: 'Selenite',      color: '#80e0e0' },
  { name: 'Chalk Ember',   color: '#f0a870' },
  { name: 'Vapor',         color: '#a0a8f0' },
  { name: 'Pale Flame',    color: '#f08870' },
  { name: 'White Sage',    color: '#80e0a0' },
  { name: 'Rime',          color: '#68c8f0' },
];

function takenNames(awareness) {
  const taken = new Set();
  const myClientId = awareness.clientID;
  awareness.getStates().forEach((state, clientId) => {
    if (clientId !== myClientId && state.user?.name) {
      taken.add(state.user.name);
    }
  });
  return taken;
}

function pickAvailable(awareness) {
  const taken = takenNames(awareness);
  const available = SHADES.filter((s) => !taken.has(s.name));
  const pool = available.length > 0 ? available : SHADES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function createUserIdentity(awareness) {
  const shade = pickAvailable(awareness);
  return { name: shade.name, color: shade.color };
}

function setupCollisionGuard(awareness, onReassign) {
  let resolving = false;
  awareness.on('change', () => {
    if (resolving) return;
    const myState = awareness.getLocalState();
    if (!myState?.user) return;
    const myName = myState.user.name;
    const myClientId = awareness.clientID;
    let dominated = false;
    awareness.getStates().forEach((state, clientId) => {
      if (clientId !== myClientId && state.user?.name === myName) {
        if (clientId < myClientId) dominated = true;
      }
    });
    if (dominated) {
      resolving = true;
      const shade = pickAvailable(awareness);
      const identity = { name: shade.name, color: shade.color };
      awareness.setLocalStateField('user', identity);
      onReassign(identity);
      resolving = false;
    }
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function main() {
  console.log(`\n=== Collaborative Editor Integration Test ===\n`);
  console.log(`Connecting ${USER_COUNT} users to room "${ROOM}"...\n`);

  const users = [];

  for (let i = 0; i < USER_COUNT; i++) {
    const doc = new Y.Doc();
    const ytext = doc.getText('codemirror');
    const provider = new WebsocketProvider(WS_URL, ROOM, doc, { disableBc: true });

    await new Promise((resolve) => {
      if (provider.wsconnected) {
        resolve();
      } else {
        provider.once('sync', resolve);
      }
    });

    await sleep(300);

    const identity = createUserIdentity(provider.awareness);
    provider.awareness.setLocalStateField('user', identity);

    setupCollisionGuard(provider.awareness, (newIdentity) => {
      users[i].identity = newIdentity;
    });

    users.push({ doc, ytext, provider, identity, clientID: doc.clientID });
    console.log(`  User ${i + 1} connected: "${identity.name}" (${identity.color}) clientID=${doc.clientID}`);

    await sleep(500);
  }

  await sleep(1000);

  // ─── Condition 1: Multiple users connect to a shared input field ───
  console.log('\n─── Condition 1: Multiple users connect to a shared input field ───');
  const connectedCount = users.filter((u) => u.provider.wsconnected).length;
  assert(connectedCount === USER_COUNT, `${connectedCount}/${USER_COUNT} users are connected`);

  for (const u of users) {
    const states = u.provider.awareness.getStates();
    assert(states.size === USER_COUNT, `User "${u.identity.name}" sees ${states.size}/${USER_COUNT} awareness states`);
  }

  // ─── Condition 2: Each user has its own caret (independent awareness) ───
  console.log('\n─── Condition 2: Each user has its own caret ───');
  const clientIDs = new Set(users.map((u) => u.clientID));
  assert(clientIDs.size === USER_COUNT, `All ${USER_COUNT} users have distinct clientIDs`);

  for (const u of users) {
    const localState = u.provider.awareness.getLocalState();
    assert(localState?.user != null, `User "${u.identity.name}" has local awareness state with user info`);
  }

  // ─── Condition 3: Each caret has a unique color among users ───
  console.log('\n─── Condition 3: Each caret has a unique color among users ───');
  const names = users.map((u) => u.identity.name);
  const colors = users.map((u) => u.identity.color);
  const uniqueNames = new Set(names);
  const uniqueColors = new Set(colors);
  assert(uniqueNames.size === USER_COUNT, `All ${USER_COUNT} users have unique names: ${names.join(', ')}`);
  assert(uniqueColors.size === USER_COUNT, `All ${USER_COUNT} users have unique colors: ${colors.join(', ')}`);

  // Cross-check from each user's awareness perspective
  for (const u of users) {
    const allColors = new Set();
    u.provider.awareness.getStates().forEach((state) => {
      if (state.user?.color) allColors.add(state.user.color);
    });
    assert(allColors.size === USER_COUNT, `From "${u.identity.name}" POV: ${allColors.size} unique colors in awareness`);
  }

  // ─── Condition 4: Each user types text in their own color ───
  console.log('\n─── Condition 4: Each user types text in their own color ───');
  const texts = ['hello-from-user1', 'hello-from-user2', 'hello-from-user3'];

  for (let i = 0; i < USER_COUNT; i++) {
    const u = users[i];
    const text = texts[i];
    const color = u.identity.color;
    const startPos = u.ytext.length;

    u.ytext.insert(startPos, text);

    await sleep(50);

    u.ytext.doc.transact(() => {
      u.ytext.format(startPos, text.length, { color, author: u.clientID });
    }, 'color-format');

    console.log(`  User "${u.identity.name}" typed "${text}" at pos ${startPos}`);
  }

  await sleep(1000);

  for (let i = 0; i < USER_COUNT; i++) {
    const u = users[i];
    const text = texts[i];
    const expectedColor = u.identity.color;

    const delta = u.ytext.toDelta();
    let found = false;

    for (const op of delta) {
      if (typeof op.insert === 'string') {
        const idx = op.insert.indexOf(text);
        if (idx !== -1) {
          found = true;
          assert(
            op.attributes?.color === expectedColor,
            `Text "${text}" has color ${op.attributes?.color} (expected ${expectedColor})`,
          );
          break;
        }
      }
    }

    if (!found) {
      let allText = '';
      for (const op of delta) {
        if (typeof op.insert === 'string') allText += op.insert;
      }
      assert(false, `Text "${text}" not found in delta (full text: "${allText}")`);
    }
  }

  // Verify all users see the same combined text
  const fullText0 = users[0].ytext.toString();
  for (let i = 1; i < USER_COUNT; i++) {
    const fullTextI = users[i].ytext.toString();
    assert(fullTextI === fullText0, `User ${i + 1} sees same text as User 1: "${fullTextI}"`);
  }

  // ─── Condition 5: Each user sees other users' carets with correct color ───
  console.log('\n─── Condition 5: Each user sees other users\' carets with correct user color ───');

  for (let i = 0; i < USER_COUNT; i++) {
    const observer = users[i];
    const states = observer.provider.awareness.getStates();

    for (let j = 0; j < USER_COUNT; j++) {
      if (i === j) continue;
      const other = users[j];
      const otherState = states.get(other.clientID);
      assert(
        otherState != null,
        `User "${observer.identity.name}" sees awareness of "${other.identity.name}" (clientID ${other.clientID})`,
      );
      if (otherState) {
        assert(
          otherState.user?.color === other.identity.color,
          `User "${observer.identity.name}" sees "${other.identity.name}" with color ${otherState.user?.color} (expected ${other.identity.color})`,
        );
      }
    }
  }

  // ─── Summary ───
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  // Cleanup
  for (const u of users) {
    u.provider.disconnect();
    u.provider.destroy();
    u.doc.destroy();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(2);
});
