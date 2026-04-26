import type { Awareness } from 'y-protocols/awareness';

interface Shade {
  name: string;
  color: string;
  glow: string;
}

export const SHADES: Shade[] = [
  { name: 'Moonstone',     color: '#90b8f8', glow: '#5080d0' },
  { name: 'Pearl Dust',    color: '#f090c0', glow: '#d06090' },
  { name: 'Frost Whisper', color: '#70d0f0', glow: '#40a0d0' },
  { name: 'Silver Dawn',   color: '#c0c0c0', glow: '#808080' },
  { name: 'Ghost Orchid',  color: '#c090f0', glow: '#9060d0' },
  { name: 'Bone Light',    color: '#f0d080', glow: '#c0a050' },
  { name: 'Selenite',      color: '#80e0e0', glow: '#50b0b0' },
  { name: 'Chalk Ember',   color: '#f0a870', glow: '#d08040' },
  { name: 'Vapor',         color: '#a0a8f0', glow: '#7078d0' },
  { name: 'Pale Flame',    color: '#f08870', glow: '#d06048' },
  { name: 'White Sage',    color: '#80e0a0', glow: '#50b070' },
  { name: 'Rime',          color: '#68c8f0', glow: '#4098c8' },
];

export interface UserIdentity {
  name: string;
  color: string;
  colorLight: string;
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
  return { name: shade.name, color: shade.color, colorLight: shade.glow };
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
