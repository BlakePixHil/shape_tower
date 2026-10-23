// The Daily ladder in the game (gameplay.md §12.3): today's list for the Daily card, the player's name and
// portrait (one pair for the Profile and the ladder, §10.3) and the card that picks them, the scored try's
// progress on its way to the ladder, and deleting it all. The ladder itself is online/online.ts (the API,
// or the game page's own); this file turns it into what the screens show.

import { PORTRAIT_ART, type LadderPanelData, type LadderRowData, type NameCardData, type PortraitChoice } from '@art/index.ts';
import { BY_ID } from '../meta/achievements.ts';
import { dailyDay, ladderReady, type DailyState } from '../meta/daily.ts';
import { shownName, type LadderRow, type LadderView } from '../meta/ladder.ts';
import { NAME_HINT, nameProblem, tidyName } from '../meta/names/names.ts';
import { portraitDef, portraitOwned } from '../meta/portraits.ts';
import { Ladder, chooseBackend, errorOf } from '../online/online.ts';
import { RENAME_MS, type LadderError, type Look } from '../online/protocol.ts';
import type { DailyLadderHooks, NameCardHooks, ProfileIdentity } from './screens.ts';
import type { Profile } from './profile.ts';

/** What the ladder's refusals say on the name card. */
const ERROR_LINE: Partial<Record<LadderError, string>> = {
  ...NAME_HINT,
  offline: "Can't reach the ladder. Check your connection and try again.",
  busy: 'The ladder is busy. Try again in a moment.',
  noname: "This copy of the game can't join the ladder.",
};

const DAY_MS = 86_400_000;
const REPORTED = 'Your name was reported, so the ladder shows a stand-in. Pick a new one to show yours.';

export class DailyLadder {
  ladder: Ladder | null = null;
  /** The shop portraits the player has bought (the Workshop's store). */
  bought: () => string[] = () => [];
  /** Opens the Workshop on a locked shop portrait; `back` is where the name card's close goes. */
  shop: ((portrait: string, back: () => void) => void) | null = null;
  /** Resolves once the game knows which ladder it's on (the game page asks claude.ai first). */
  readonly ready: Promise<Ladder>;

  constructor(private profile: Profile, private still: () => boolean, private onNamed: (name: string | null) => void) {
    this.ready = chooseBackend().catch(() => null).then(b => {
      const l = (this.ladder = new Ladder(b));
      this.onNamed(l.me?.name ?? null);
      if (l.available) void l.refresh().then(() => { this.onNamed(l.me?.name ?? null); void l.flush(); });
      return l;
    });
  }

  private look(): Look { return { portrait: this.ladder?.state.portrait ?? 'meadow', avatar: this.profile.avatar }; }

  /** The scored try so far, on its way to the ladder (only under the current rules, and only once named). */
  submit(day: string): void {
    const r = this.profile.daily.scored[day];
    if (!ladderReady(r)) return;
    void this.ready.then(l => l.submit({ day, height: r.height, score: r.score, checkpoints: r.checkpoints, finished: r.finished, startedAt: Date.parse(r.at) }));
  }

  /** The player's Blockling changed: their ladder row follows. */
  restyle(): void { void this.ladder?.setLook(this.look()); }

  /**
   * The Profile's name and portrait: the ones the ladder shows. Without a ladder in this copy of the game
   * there are no names, so no button.
   */
  identity(): ReturnType<ProfileIdentity['get']> {
    const l = this.ladder;
    const portrait = l?.state.portrait ?? 'meadow';
    if (l && !l.available) return { portrait };
    return { portrait, nameAction: l?.named ? 'edit' : 'pick', nameNote: l?.me?.hidden ? REPORTED : undefined };
  }

  /** The Daily card's ladder hooks. `onName` opens the name card. */
  hooks(onName: () => void): DailyLadderHooks {
    return {
      load: () => this.panel(),
      onName: () => { void this.ready.then(onName); },
      onReport: async id => { await this.ladder?.report(id); },
    };
  }

  /** Today's ladder as the card shows it. */
  async panel(): Promise<LadderPanelData> {
    const l = await this.ready;
    void l.flush();
    const day = dailyDay();
    const base = this.basePanel(l);
    if (!l.available) return { ...base, state: 'none' };
    const v = await l.view(day);
    if (typeof v === 'string') return { ...base, state: 'offline' };
    return { ...base, state: 'ready', total: v.total, rows: v.top.map(r => this.row(r)), me: v.me ? this.row(v.me) : null, note: this.note(this.profile.daily, day, v) };
  }

  /** The panel before the ladder answers (what the card opens with). */
  loadingPanel(): LadderPanelData {
    const base = this.basePanel(this.ladder);
    return this.ladder && !this.ladder.available ? { ...base, state: 'none' } : base;
  }

  private basePanel(l: Ladder | null): LadderPanelData {
    return {
      state: 'loading', scope: l?.backend?.kind === 'page' ? 'This page' : 'Everyone', total: 0, rows: [], me: null,
      joined: !!l?.named, you: { name: l?.me?.name ?? '', portrait: l?.state.portrait ?? 'meadow', avatar: this.profile.avatar }, still: this.still(),
    };
  }

  private row(r: LadderRow): LadderRowData {
    const mine = r.id === this.ladder?.me?.id;
    const reported = !mine && (this.ladder?.state.reported.includes(r.id) ?? false);
    return {
      id: r.id, rank: r.rank, height: r.height, portrait: r.portrait, avatar: r.avatar as LadderRowData['avatar'], live: !r.finished, me: mine,
      name: mine && this.ladder?.me?.name && !this.ladder.me.hidden ? this.ladder.me.name : shownName({ ...r, hidden: r.hidden || reported }),
      reported: reported || r.hidden,
    };
  }

  /** Why the player's try isn't on today's ladder, when it isn't. */
  private note(d: DailyState, day: string, v: LadderView): string | undefined {
    const r = d.scored[day];
    if (this.ladder?.me?.hidden) return REPORTED;
    if (r && !ladderReady(r)) return "Your try from earlier today was before the new Daily, so it isn't on the ladder. Today's new try is open.";
    if (r && !this.ladder?.named) return 'Pick a name and your try today joins the ladder.';
    if (r && this.ladder?.named && !v.me) return this.ladder.state.pending ? 'Your try is on its way to the ladder.' : undefined;
    return undefined;
  }

  // ------------------------------------------------------------------ the name card (from the Profile or the Daily card)

  nameHooks(back: () => void): NameCardHooks {
    const l = this.ladder;
    const me = l?.me ?? null;
    const joined = !!l?.named;
    const wait = me?.renamedAt && !me.hidden ? me.renamedAt + RENAME_MS - Date.now() : 0;
    const data: NameCardData = {
      name: me?.name ?? '', portrait: l?.state.portrait ?? 'meadow', avatar: this.profile.avatar, joined, still: this.still(),
      portraits: this.choices(),
      rule: !joined ? 'Your name and portrait show on your profile and on the Daily ladder for everyone. Letters, numbers, spaces, - and _. You can change it once a week.'
        : wait > 0 ? `You can change your name once a week: next change in ${Math.ceil(wait / DAY_MS)} ${Math.ceil(wait / DAY_MS) === 1 ? 'day' : 'days'}. Portraits change any time.`
        : 'You can change your name once a week. Portraits change any time.',
    };
    return {
      data,
      hint: name => {
        const p = nameProblem(name);
        if (!tidyName(name)) return { text: '', ok: false };
        return p ? { text: NAME_HINT[p], ok: false } : { text: 'Looks good', ok: true };
      },
      onSave: async (name, portrait) => {
        if (!l) return ERROR_LINE.offline!;
        const look = { portrait, avatar: this.profile.avatar };
        const wasJoined = l.named;
        const r = me?.name === tidyName(name) && !me.hidden ? await l.setLook(look) : await l.setName(name, look);
        const e = errorOf(r);
        if (e) return ERROR_LINE[e] ?? NAME_HINT.blocked;
        l.state.portrait = portrait;
        this.onNamed(l.me?.name ?? null);
        // Today's try, if there is one, joins the ladder as soon as they have a name.
        if (!wasJoined) this.submit(dailyDay());
        back();
        return null;
      },
      onForget: async () => {
        const e = await this.forget();
        if (!e) back();
        return e;
      },
      onClose: back,
      onWorkshop: portrait => this.shop?.(portrait, back),
    };
  }

  /** "Delete my name and Daily scores". Resolves an error line, or null when it's done. */
  async forget(): Promise<string | null> {
    const l = await this.ready;
    const e = errorOf(await l.forget());
    if (e) return ERROR_LINE[e] ?? ERROR_LINE.offline!;
    this.onNamed(null);
    return null;
  }

  /** Every portrait: owned ones to pick, the rest with what unlocks them (no prices here: those are in the Workshop). */
  private choices(): PortraitChoice[] {
    const owner = { level: this.profile.level, achievements: this.profile.achievements, bought: this.bought() };
    return PORTRAIT_ART.map(a => {
      const def = portraitDef(a.id);
      const owned = !!def && portraitOwned(a.id, owner);
      const lock = !def ? 'Locked'
        : def.source === 'level' ? `Level ${def.level}`
        : def.source === 'achievement' ? (BY_ID.get(def.achievement ?? '')?.name ?? 'An achievement')
        : def.source === 'shop' ? 'Workshop' : 'Supporter Pack · Soon';
      return { id: a.id, name: a.name, animated: a.animated, owned, lock: owned ? undefined : lock };
    });
  }
}
