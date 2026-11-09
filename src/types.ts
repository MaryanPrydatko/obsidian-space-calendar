import type { Card } from './sources/kanban-parse';

/** One thing on the calendar: an event (from an ICS feed or Google) or a Kanban card with a date. */
export interface Item {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  kind: 'event' | 'card';
  src: 'kanban' | 'ics' | 'google';
  done?: boolean;
  /** A Google event on a calendar you can write: drag, stretch, edit, delete. */
  editable?: boolean;
  /** A card whose time was read: only its start is known. */
  openEnd?: boolean;
  calName?: string;
  location?: string;
  desc?: string;
  link?: string;
  meet?: string;
  card?: Card;
  g?: GRef;
  lane?: number;
  lanes?: number;
  span?: number;
}

/** Where a Google event lives, for writing it back. */
export interface GRef { cal: string; id: string; etag: string; rec?: string; colorId?: string; calColor?: string }

/** The fields a Google change or a new event carries. */
export interface GFields { title?: string; start?: Date; end?: Date; allDay?: boolean; colorId?: string; desc?: string; location?: string }

export interface SpaceCalSettings {
  weekStart: 0 | 1;
  defaultView: 'now' | 'day' | 'week' | 'month';
  dailyFolder: string;
  textTimes: boolean;
  showDone: boolean;
}

export const DEFAULT_SETTINGS: SpaceCalSettings = { weekStart: 1, defaultView: 'week', dailyFolder: 'Daily', textTimes: true, showDone: true };
