import type { Awareness } from 'y-protocols/awareness';

interface Shade {
  name: string;
  color: string;
}

export const SHADES: Shade[] = [
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

export interface UserIdentity {
  name: string;
  color: string;
}

function takenNames(awareness: Awareness): Set<string> {
  const taken = new Set<string>();
  const myClientId = awareness.clientID;
  awareness.getStates().forEach((state, clientId) => {
    if (clientId !== myClientId && state.user?.name) {
      taken.add(state.user.name);
    }
  });
  return taken;
}

function pickAvailable(awareness: Awareness): Shade {
  const taken = takenNames(awareness);
  const available = SHADES.filter((s) => !taken.has(s.name));
  const pool = available.length > 0 ? available : SHADES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function shadeToIdentity(shade: Shade): UserIdentity {
  return { name: shade.name, color: shade.color };
}

export function createUserIdentity(awareness: Awareness): UserIdentity {
  return shadeToIdentity(pickAvailable(awareness));
}

export function setupCollisionGuard(
  awareness: Awareness,
  onReassign: (identity: UserIdentity) => void,
) {
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
      try {
        const newShade = pickAvailable(awareness);
        const identity = shadeToIdentity(newShade);
        awareness.setLocalStateField('user', identity);
        onReassign(identity);
      } finally {
        resolving = false;
      }
    }
  });
}
