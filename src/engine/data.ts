/**
 * BRIMSTONE & BREW game data. Everything balance-related lives here so it can be
 * tuned without touching the rules engine.
 *
 * Theme glossary (player-facing word -> internal identifier, kept stable so the
 * engine and tests did not need renaming):
 *   Ingredient -> Change, Satchel -> backlog/pile, Cauldron + Brew Track -> position,
 *   Brimstone -> 'bug' (danger), KABOOM -> status 'down', CORK IT -> 'ship',
 *   Ladle (scoop out a Brimstone) -> rollback, Silver -> budget, Renown -> up,
 *   Moonstones -> coffee, Underdog's Luck -> relief/headStart, Omens -> CAB notices,
 *   Lucky Die -> kudos, Herb Market -> vendor phase, Stoke the Fire -> improve.
 */

export type ChangeType =
  | 'bug'
  | 'hotfix'
  | 'script'
  | 'logreview'
  | 'automation'
  | 'unittest'
  | 'shadowit'
  | 'exec';

export interface ChangeDef {
  type: ChangeType;
  name: string;
  short: string;
  color: string;
  /** Herb Market price by value. Missing value = not for sale at that size. */
  prices: Partial<Record<number, number>>;
  /** First round (1-based) in which this change is sold at the Herb Market. */
  unlockRound: number;
  emoji: string;
}

export const CHANGES: Record<ChangeType, ChangeDef> = {
  bug: {
    type: 'bug',
    name: 'Brimstone',
    short: 'Volatile! More than 7 Brimstone in your cauldron and it goes KABOOM.',
    color: '#e9e4d4',
    prices: {},
    unlockRound: 99,
    emoji: '☄️',
  },
  hotfix: {
    type: 'hotfix',
    name: 'Dewleaf',
    short: '+1 Moonstone if it is your last or second-to-last ingredient.',
    color: '#5fcf80',
    prices: { 1: 4, 2: 8, 4: 14 },
    unlockRound: 1,
    emoji: '🍃',
  },
  script: {
    type: 'script',
    name: 'Carrot',
    short: 'Cheap and cheerful. No effect.',
    color: '#f29b38',
    prices: { 1: 3 },
    unlockRound: 1,
    emoji: '🥕',
  },
  logreview: {
    type: 'logreview',
    name: 'Owl Feather',
    short: 'Peek at 1/2/4 ingredients in your satchel; add one or none.',
    color: '#5aa6e8',
    prices: { 1: 5, 2: 10, 4: 19 },
    unlockRound: 1,
    emoji: '🪶',
  },
  unittest: {
    type: 'unittest',
    name: 'Salt Crystal',
    short: 'If the previous ingredient was Brimstone, toss that Brimstone back in the satchel.',
    color: '#f2d257',
    prices: { 1: 5, 2: 9, 4: 18 },
    unlockRound: 1,
    emoji: '🧂',
  },
  automation: {
    type: 'automation',
    name: 'Ember Pepper',
    short: '+1 extra space per Carrot already in the cauldron (max +2).',
    color: '#e8513f',
    prices: { 1: 6, 2: 11, 4: 21 },
    unlockRound: 2,
    emoji: '🌶️',
  },
  shadowit: {
    type: 'shadowit',
    name: 'Shadow Plum',
    short: 'At scoring: more than one neighbor = +1 space; more than both = +1 space and +1 Moonstone.',
    color: '#4a3f5c',
    prices: { 1: 10 },
    unlockRound: 2,
    emoji: '🫐',
  },
  exec: {
    type: 'exec',
    name: 'Starbloom',
    short: 'At scoring: 1 = +1 Renown, 2 = +1 Renown +1 Moonstone, 3+ = +2 Renown + a free Carrot.',
    color: '#b77be8',
    prices: { 1: 10 },
    unlockRound: 3,
    emoji: '🌸',
  },
};

export const CHANGE_TYPES = Object.keys(CHANGES) as ChangeType[];

export const BUG_LIMIT = 7;
export const ROUNDS = 9;
export const MAX_SEATS = 6;
export const ROLLBACK_RECHARGE_COST = 3; // Moonstones (restore the Ladle)
export const PROCESS_IMPROVEMENT_COST = 2; // Moonstones (Stoke the Fire)
export const MAX_START_POS = 12;
export const BUDGET_PER_UP = 5; // final conversion: Silver per Renown
export const COFFEE_PER_UP = 2; // final conversion: Moonstones per Renown
export const MAX_PURCHASES = 2;

export const STARTING_BACKLOG: Array<{ type: ChangeType; value: number }> = [
  { type: 'bug', value: 1 },
  { type: 'bug', value: 1 },
  { type: 'bug', value: 1 },
  { type: 'bug', value: 1 },
  { type: 'bug', value: 2 },
  { type: 'bug', value: 2 },
  { type: 'bug', value: 3 },
  { type: 'hotfix', value: 1 },
  { type: 'script', value: 1 },
];

export interface PipelineSpace {
  budget: number;
  up: number;
  coffee: boolean;
}

const COFFEE_SPACES = new Set([5, 9, 13, 16, 20, 24, 27, 31]);

/** The Brew Track: 34 spaces (0..33). Silver and Renown both climb along it. */
export const PIPELINE: PipelineSpace[] = Array.from({ length: 34 }, (_, i) => ({
  budget: i + Math.floor(i / 6),
  up: Math.floor((i * i) / 110 + i / 5),
  coffee: COFFEE_SPACES.has(i),
}));
export const LAST_SPACE = PIPELINE.length - 1;

/** Underdog's Luck icons on the Renown scoring track. */
export const RELIEF_ICONS: number[] = [
  2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 23, 26, 29, 32, 35, 38, 42, 46, 50, 55, 60, 65, 70, 80, 90,
];

export type KudosFace =
  | { kind: 'up'; amount: number }
  | { kind: 'coffee'; amount: number }
  | { kind: 'budget'; amount: number }
  | { kind: 'script' };

export const KUDOS_DIE: KudosFace[] = [
  { kind: 'up', amount: 1 },
  { kind: 'up', amount: 2 },
  { kind: 'up', amount: 1 },
  { kind: 'coffee', amount: 1 },
  { kind: 'budget', amount: 3 },
  { kind: 'script' },
];

export function kudosLabel(f: KudosFace): string {
  switch (f.kind) {
    case 'up':
      return `+${f.amount} ★`;
    case 'coffee':
      return `+${f.amount} 💎`;
    case 'budget':
      return `+${f.amount} 🪙`;
    case 'script':
      return 'Free Carrot';
  }
}

/** Night modifiers an Omen can set. Defaults in DEFAULT_MODS. */
export interface RoundMods {
  bugLimit: number;
  firstChangeDouble: boolean;
  freezeOn3s: boolean;
  downTakesBoth: boolean;
  priceDiscount: number;
  budgetDelta: number;
  scriptBonus: number;
  startBonus: number;
  kudosRolls: number;
  complianceBonus: boolean;
  retroBonus: boolean;
  execBonus: number;
  hotfixWindow: number;
  firstBugFree: boolean;
  reliefMultiplier: number;
}

export const DEFAULT_MODS: RoundMods = {
  bugLimit: BUG_LIMIT,
  firstChangeDouble: false,
  freezeOn3s: false,
  downTakesBoth: false,
  priceDiscount: 0,
  budgetDelta: 0,
  scriptBonus: 0,
  startBonus: 0,
  kudosRolls: 1,
  complianceBonus: false,
  retroBonus: false,
  execBonus: 0,
  hotfixWindow: 2,
  firstBugFree: false,
  reliefMultiplier: 1,
};

export type InstantEffect = 'coffeeAll' | 'coffeeLast' | 'scriptAll' | 'rechargeAll';

export interface CabNotice {
  id: string;
  title: string;
  text: string;
  mods?: Partial<RoundMods>;
  instant?: InstantEffect;
}

export const CAB_NOTICES: CabNotice[] = [
  { id: 'readonly-friday', title: 'Bubbling Start', text: "Everyone's first ingredient tonight moves double.", mods: { firstChangeDouble: true } },
  { id: 'audit-season', title: 'Meteor Shower', text: 'Everyone finds a Moonstone in the grass.', instant: 'coffeeAll' },
  { id: 'vendor-sale', title: 'Haggling Day', text: 'Ingredients cost 2 Silver less at the Herb Market tonight.', mods: { priceDiscount: 2 } },
  { id: 'change-freeze', title: 'Calm Winds', text: 'Your 2nd Brimstone worth 3 corks your cauldron on the spot, even if it would have blown.', mods: { freezeOn3s: true } },
  { id: 'pizza', title: 'Kindly Stranger', text: 'The brewer(s) in last place gain 1 Moonstone.', instant: 'coffeeLast' },
  { id: 'blameless-postmortem', title: 'Forgiving Crowd', text: 'If your cauldron explodes you keep BOTH the Silver and the Renown tonight.', mods: { downTakesBoth: true } },
  { id: 'load-test', title: 'Iron Cauldrons', text: 'Cauldrons are sturdy tonight: the Brimstone limit is 9.', mods: { bugLimit: 9 } },
  { id: 'pager-storm', title: 'Thunderstorm', text: 'Brimstone limit is 6 tonight, but everyone starts 2 spaces ahead.', mods: { bugLimit: 6, startBonus: 2 } },
  { id: 'hackathon', title: 'Bumper Harvest', text: 'Everyone adds a free Carrot to their satchel.', instant: 'scriptAll' },
  { id: 'budget-cuts', title: 'Tax Collector', text: 'Everyone earns 3 Silver less tonight.', mods: { budgetDelta: -3 } },
  { id: 'espresso', title: 'The Ladle Smith', text: "Everyone's Ladle is restored for free.", instant: 'rechargeAll' },
  { id: 'stakeholder-demo', title: 'Royal Visit', text: 'The Lucky Die is rolled twice tonight.', mods: { kudosRolls: 2 } },
  { id: 'reorg', title: 'Warm Embers', text: 'Everyone starts 1 space ahead tonight.', mods: { startBonus: 1 } },
  { id: 'legacy-migration', title: 'Carrot Festival', text: 'Carrots move 1 extra space tonight.', mods: { scriptBonus: 1 } },
  { id: 'compliance', title: 'Guild Inspection', text: 'Brewers with no Shadow Plums in the cauldron gain 1 Renown at scoring.', mods: { complianceBonus: true } },
  { id: 'sprint-retro', title: 'Steady Hands', text: 'Brewers who CORK IT with 4 or less Brimstone gain 2 Renown.', mods: { retroBonus: true } },
  { id: 'exec-visit', title: 'Full Bloom', text: 'Starblooms count one extra at scoring (if you added any).', mods: { execBonus: 1 } },
  { id: 'bonus-season', title: 'Generous Patron', text: 'Everyone earns 4 extra Silver tonight.', mods: { budgetDelta: 4 } },
  { id: 'holiday-freeze', title: 'Morning Dew', text: 'Dewleaf earns a Moonstone if it is among your last 3 ingredients.', mods: { hotfixWindow: 3 } },
  { id: 'works-on-my-machine', title: "Beginner's Luck", text: 'Your first Brimstone tonight counts as 0. It still moves you.', mods: { firstBugFree: true } },
  { id: 'debt-sprint', title: 'Underdog Night', text: "Underdog's Luck is doubled tonight.", mods: { reliefMultiplier: 2 } },
];

export interface AvatarDef {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

export const AVATARS: AvatarDef[] = [
  { id: 'helpdesk', name: 'Herbalist', emoji: '🌿', color: '#5fcf80' },
  { id: 'netwizard', name: 'Hedge Wizard', emoji: '🧙', color: '#5aa6e8' },
  { id: 'dba', name: 'Alchemist', emoji: '⚗️', color: '#f2d257' },
  { id: 'goblin', name: 'Swamp Hag', emoji: '🐸', color: '#e8513f' },
  { id: 'cloud', name: 'Star Seer', emoji: '🔮', color: '#b77be8' },
  { id: 'intern', name: 'Apprentice', emoji: '🐣', color: '#f29b38' },
];
export const VENDOR_AVATAR: AvatarDef = { id: 'vendor', name: 'Rival Peddler', emoji: '🦝', color: '#a89a86' };
export const BOT_AVATAR: AvatarDef = { id: 'bot', name: 'Bot', emoji: '🤖', color: '#7fd1b9' };

export function avatarById(id: string): AvatarDef {
  return AVATARS.find((a) => a.id === id) ?? (id === 'vendor' ? VENDOR_AVATAR : BOT_AVATAR);
}
