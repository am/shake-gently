const NAMES = [
  'Alice', 'Bob', 'Charlie', 'Dana', 'Eve', 'Frank',
  'Grace', 'Hank', 'Ivy', 'Jack', 'Kara', 'Leo',
  'Mia', 'Nate', 'Olive', 'Pat', 'Quinn', 'Ray',
];

const COLORS = [
  '#e06c75', '#61afef', '#98c379', '#e5c07b',
  '#c678dd', '#56b6c2', '#d19a66', '#be5046',
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f7dc6f',
  '#bb8fce', '#82e0aa', '#f0b27a', '#aed6f1',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface UserIdentity {
  name: string;
  color: string;
  colorLight: string;
}

export function createUserIdentity(): UserIdentity {
  const color = pick(COLORS);
  return {
    name: pick(NAMES),
    color,
    colorLight: color + '40',
  };
}
