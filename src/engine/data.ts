/**
 * PATCH TUESDAY game data. Everything balance-related lives here so it can be
 * tuned without touching the rules engine.
 *
 * Glossary: Server = your board, Deployment Pipeline = your track,
 * Changes = the tiles in your Backlog (bag), Bugs = danger changes,
 * PROD DOWN = outage, SHIP IT = stop drawing, Rollback = put a Bug back,
 * Budget ($) = spending money, Uptime Points (UP) = score, Coffee = gems,
 * Tech Debt Relief = catch-up, CAB Notices = round modifiers,
 * Kudos Die = bonus die, Vendor Portal = shop.
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
  /** Vendor Portal price by value. Missing value = not for sale at that size. */
  prices: Partial<Record<number, number>>;
  /** First round (1-based) in which this change is sold in the Vendor Portal. */
  unlockRound: number;
  emoji: string;
}

export const CHANGES: Record<ChangeType, ChangeDef> = {
  bug: {
    type: 'bug',
    name: 'Bug',
    short: 'Adds to your Bug total. Over 7 and PROD GOES DOWN.',
    color: '#e8e8e8',
    prices: {},
    unlockRound: 99,
    emoji: '🐛',
  },
  hotfix: {
    type: 'hotfix',
    name: 'Hotfix',
    short: '+1 Coffee if it is your last or second-to-last change.',
    color: '#3ddc84',
    prices: { 1: 4, 2: 8, 4: 14 },
    unlockRound: 1,
    emoji: '🩹',
  },
  script: {
    type: 'script',
    name: 'Script',
    short: 'Cheap and cheerful. No effect.',
    color: '#ff9f1c',
    prices: { 1: 3 },
    unlockRound: 1,
    emoji: '📜',
  },
  logreview: {
    type: 'logreview',
    name: 'Log Review',
    short: 'Peek at 1/2/4 changes from your backlog; deploy one or none.',
    color: '#4ea8ff',
    prices: { 1: 5, 2: 10, 4: 19 },
    unlockRound: 1,
    emoji: '🔍',
  },
  unittest: {
    type: 'unittest',
    name: 'Unit Test',
    short: 'If the previous change was a Bug, send that Bug back to the backlog.',
    color: '#ffd23f',
    prices: { 1: 5, 2: 9, 4: 18 },
    unlockRound: 1,
    emoji: '🧪',
  },
  automation: {
    type: 'automation',
    name: 'Automation',
    short: '+1 extra space per Script already deployed (max +2).',
    color: '#ff4d4d',
    prices: { 1: 6, 2: 11, 4: 21 },
    unlockRound: 2,
    emoji: '🤖',
  },
  shadowit: {
    type: 'shadowit',
    name: 'Shadow IT',
    short: 'At review: out-shadow one neighbor = +1 space; both = +1 space and +1 Coffee.',
    color: '#555566',
    prices: { 1: 10 },
    unlockRound: 2,
    emoji: '🕶️',
  },
  exec: {
    type: 'exec',
    name: 'Exec Sponsor',
    short: 'At review: 1 = +1 UP, 2 = +1 UP +1 Coffee, 3+ = +2 UP + free Script.',
    color: '#b46cff',
    prices: { 1: 10 },
    unlockRound: 3,
    emoji: '👔',
  },
};

export const CHANGE_TYPES = Object.keys(CHANGES) as ChangeType[];

export const BUG_LIMIT = 7;
export const ROUNDS = 9;
export const MAX_SEATS = 6;
export const ROLLBACK_RECHARGE_COST = 3; // Coffee
export const PROCESS_IMPROVEMENT_COST = 2; // Coffee
export const MAX_START_POS = 12;
export const BUDGET_PER_UP = 5; // final conversion
export const COFFEE_PER_UP = 2; // final conversion
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

/** 34 spaces (0..33). Budget and UP both climb along the pipeline. */
export const PIPELINE: PipelineSpace[] = Array.from({ length: 34 }, (_, i) => ({
  budget: i + Math.floor(i / 6),
  up: Math.floor((i * i) / 110 + i / 5),
  coffee: COFFEE_SPACES.has(i),
}));
export const LAST_SPACE = PIPELINE.length - 1;

/** Tech Debt Relief icons on the UP scoring track. */
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
      return `+${f.amount} UP`;
    case 'coffee':
      return `+${f.amount} ☕`;
    case 'budget':
      return `+$${f.amount}`;
    case 'script':
      return 'Free Script';
  }
}

/** Round modifiers a CAB Notice can set. Defaults in DEFAULT_MODS. */
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
  { id: 'readonly-friday', title: 'Read-Only Friday', text: "Everyone's first change this window moves double.", mods: { firstChangeDouble: true } },
  { id: 'audit-season', title: 'Audit Season', text: 'Everyone gains 1 Coffee for surviving the auditors.', instant: 'coffeeAll' },
  { id: 'vendor-sale', title: 'Vendor Sale', text: 'All changes cost $2 less in the Vendor Portal this round.', mods: { priceDiscount: 2 } },
  { id: 'change-freeze', title: 'Change Freeze', text: 'Drawing your 2nd Bug worth 3 auto-ships you on the spot, even if prod would have gone down.', mods: { freezeOn3s: true } },
  { id: 'pizza', title: 'Pizza in the Break Room', text: 'The player(s) in last place gain 1 Coffee.', instant: 'coffeeLast' },
  { id: 'blameless-postmortem', title: 'Blameless Postmortem', text: 'If prod goes down you keep BOTH the Budget and the UP this window.', mods: { downTakesBoth: true } },
  { id: 'load-test', title: 'Load Test Passed', text: 'Prod can take it: the Bug limit is 9 this window.', mods: { bugLimit: 9 } },
  { id: 'pager-storm', title: 'Pager Storm', text: 'Bug limit is 6 this window, but everyone starts 2 spaces ahead.', mods: { bugLimit: 6, startBonus: 2 } },
  { id: 'hackathon', title: 'Hackathon', text: 'Everyone adds a free Script to their backlog.', instant: 'scriptAll' },
  { id: 'budget-cuts', title: 'Budget Cuts', text: 'Everyone earns $3 less Budget this window.', mods: { budgetDelta: -3 } },
  { id: 'espresso', title: 'Espresso Machine Fixed', text: "Everyone's Rollback is recharged for free.", instant: 'rechargeAll' },
  { id: 'stakeholder-demo', title: 'Stakeholder Demo', text: 'The Kudos Die is rolled twice this window.', mods: { kudosRolls: 2 } },
  { id: 'reorg', title: 'Surprise Reorg', text: 'Everyone starts 1 space ahead this window.', mods: { startBonus: 1 } },
  { id: 'legacy-migration', title: 'Legacy Migration', text: 'Scripts move 1 extra space this window.', mods: { scriptBonus: 1 } },
  { id: 'compliance', title: 'Compliance Review', text: 'Players with no Shadow IT deployed gain 1 UP at review.', mods: { complianceBonus: true } },
  { id: 'sprint-retro', title: 'Sprint Retro', text: 'Players who SHIP IT with 4 or fewer Bug points gain 2 UP.', mods: { retroBonus: true } },
  { id: 'exec-visit', title: 'Executive Site Visit', text: 'Exec Sponsors count one extra at review (if you deployed any).', mods: { execBonus: 1 } },
  { id: 'bonus-season', title: 'Bonus Season', text: 'Everyone earns $4 extra Budget this window.', mods: { budgetDelta: 4 } },
  { id: 'holiday-freeze', title: 'Holiday Code Freeze', text: 'Hotfixes earn Coffee if they are among your last 3 changes.', mods: { hotfixWindow: 3 } },
  { id: 'works-on-my-machine', title: 'Works On My Machine', text: 'Your first Bug this window counts as 0. It still moves you.', mods: { firstBugFree: true } },
  { id: 'debt-sprint', title: 'Tech Debt Sprint', text: 'Tech Debt Relief is doubled this window.', mods: { reliefMultiplier: 2 } },
];

export interface AvatarDef {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

export const AVATARS: AvatarDef[] = [
  { id: 'helpdesk', name: 'Help Desk Hero', emoji: '🦸', color: '#3ddc84' },
  { id: 'netwizard', name: 'Network Wizard', emoji: '🧙', color: '#4ea8ff' },
  { id: 'dba', name: 'DBA', emoji: '🗄️', color: '#ffd23f' },
  { id: 'goblin', name: 'Security Goblin', emoji: '👺', color: '#ff4d4d' },
  { id: 'cloud', name: 'Cloud Architect', emoji: '☁️', color: '#b46cff' },
  { id: 'intern', name: 'Intern', emoji: '🐣', color: '#ff9f1c' },
];
export const VENDOR_AVATAR: AvatarDef = { id: 'vendor', name: 'Legacy Vendor', emoji: '🦖', color: '#9a9a9a' };
export const BOT_AVATAR: AvatarDef = { id: 'bot', name: 'Bot', emoji: '🤖', color: '#7fd1b9' };

export function avatarById(id: string): AvatarDef {
  return AVATARS.find((a) => a.id === id) ?? (id === 'vendor' ? VENDOR_AVATAR : BOT_AVATAR);
}
