import Command from '@oclif/command';
import axios from 'axios';
import { config } from 'dotenv';
import { promises, WriteStream } from 'fs';
import { capitalize } from 'lodash';
import { DateTime } from 'luxon';

import {
  Attendee,
  Event,
  ExpanderAttendee,
  ExpanderEvent,
  ExpanderOccurence,
} from './types';

let seen: any[] = [];
export abstract class IcsorgBase extends Command {
  abstract run(): PromiseLike<any>;

  private deLoop(_: any, value: any) {
    if (typeof value === 'object' && value !== null) {
      if (seen.indexOf(value) !== -1) return;
      else seen.push(value);
    }
    return value;
  }

  logJson(value: any, pretty = false) {
    seen = [];
    if (pretty) {
      return this.log(JSON.stringify(value, this.deLoop, 2));
    } else {
      return this.log(JSON.stringify(value, this.deLoop));
    }
  }

  getConfigFile(flags: any) {
    return flags.config_file || `${process.env.HOME}/.icsorgrc`;
  }

  loadConfig(flags: any) {
    return config({ path: this.getConfigFile(flags) });
  }

  dumpEvent(e: any, of: WriteStream, isRoam = false): void {
    if (!isRoam) of.write(`* ${e.summary}\n`);
    of.write(':PROPERTIES:\n');
    of.write(':ICAL_EVENT:    t\n');
    of.write(`:ID:            ${e.id}\n`);
    e.organizer &&
      of.write(`:ORGANIZER:     ${this.makeFullName(e.organizer)}\n`);
    e.status && of.write(`:STATUS:        ${e.status}\n`);
    e.modified &&
      of.write(
        `:LAST_MODIFIED: ${this.makeTimestamp(e.modified, 'inactive')}\n`,
      );
    if (isRoam) {
      e.startDate &&
        of.write(`:START_DATE:    ${this.makeTimestamp(e.startDate)}\n`);
      e.endDate &&
        of.write(`:END_DATE:      ${this.makeTimestamp(e.endDate)}\n`);
    }
    e.location && of.write(`:LOCATION:      ${e.location}\n`);
    e.duration &&
      of.write(`:DURATION:      ${this.parseDuration(e.duration)}\n`);
    e.attendees.length
      ? of.write(
          `:ATTENDEES:     ${e.attendees
            .map((a: Attendee) => `${this.makeFullName(a.cn)} (${a.status})`)
            .join(', ')}`,
        ) && of.write('\n')
      : null;
    of.write(':END:\n');
    if (isRoam) {
      of.write(`#+title: ${e.summary}\n`);
    } else {
      of.write(this.makeTimestampRange(e.startDate, e.endDate));
      of.write('\n');
      e.description && of.write(`\n${e.description}\n`);
    }
  }

  makeTimestampRange(start: any, end: any): any {
    const fmt = '<yyyy-LL-dd ccc HH:mm>';
    const sDate = DateTime.fromJSDate(start);
    const eDate = DateTime.fromJSDate(end);
    if (sDate.hasSame(eDate, 'day')) {
      const fmt1 = '<yyyy-LL-dd ccc HH:mm-';
      const fmt2 = 'HH:mm>';
      return `${sDate.toFormat(fmt1)}${eDate.toFormat(fmt2)}`;
    }
    return `${sDate.toFormat(fmt)}--${eDate.toFormat(fmt)}`;
  }

  parseDuration(d: any) {
    function pad(v: number) {
      return v < 10 ? `0${v}` : `${v}`;
    }

    if (d.weeks) {
      return `${d.weeks} wk ${d.days} d ${pad(d.hours)}:${pad(d.hours)} hh:mm`;
    } else if (d.days) {
      return `${d.days} d ${pad(d.hours)}:${pad(d.minutes)} hh:mm`;
    } else {
      return `${pad(d.hours)}:${pad(d.minutes)} hh:mm`;
    }
  }

  makeTimestamp(dt: any, type = 'active') {
    let start = '<';
    let end = '>';

    if (type === 'inactive') {
      start = '[';
      end = ']';
    }
    const fmt = `${start}yyyy-LL-dd ccc HH:mm${end}`;
    if (dt) {
      const date = DateTime.fromJSDate(dt);
      return date.toFormat(fmt, { locale: 'au' });
    }
    return '';
  }

  makeFullName(data: string) {
    if (data && data.startsWith('mailto:')) {
      data = data.substring(7);
    }

    const matches = data.match(/(\w+)\.(\w+)@.+?$/);
    if (matches && matches.length === 3) {
      data = `${capitalize(matches[1])} ${capitalize(matches[2])}`;
    }

    return `[[${data}][${data}]]`;
  }

  mapOccurences(
    occurrences: ExpanderOccurence[],
    author?: string,
    email?: string,
  ): Event[] {
    const mappedOccurrences = occurrences.map<Event>(
      (o: ExpanderOccurence) => ({
        startDate: o.startDate.toJSDate(),
        endDate: o.endDate.toJSDate(),
        ...this.commonEventProperties(o.item, author, email),
      }),
    );
    return mappedOccurrences;
  }

  mapEvents(events: ExpanderEvent[], author?: string, email?: string): Event[] {
    const mappedEvents = events.map<Event>((e: ExpanderEvent) => ({
      endDate: e.endDate.toJSDate(),
      startDate: e.startDate.toJSDate(),
      ...this.commonEventProperties(e, author, email),
    }));
    return mappedEvents;
  }

  commonEventProperties(e: ExpanderEvent, author?: string, email?: string) {
    return {
      attendees: e.attendees.map((a: ExpanderAttendee) =>
        this.parseAttendee(a.jCal[1], author, email),
      ),
      description: e.description,
      duration: e.duration,
      location: e.location,
      organizer: e.organizer,
      uid: e.uid,
      status: this.getPropertyValue('status', e.component),
      modified: this.getPropertyValue('last-modified', e.component),
      summary: e.summary,
    };
  }

  parseAttendee(data: any, author?: string, email?: string) {
    return {
      category: data.category,
      role: data.role,
      status: data.partstat,
      cn: data.cn,
      guests: data['x-num-guests'],
      me: data.cn === author || data.cn === email ? true : false,
    };
  }

  getPropertyValue(name: string, component: any) {
    const prop = component.getFirstProperty(name);
    if (prop) {
      switch (prop.getDefaultType()) {
        case 'text':
          return prop.getFirstValue();
        case 'date-time': {
          const val = prop.getFirstValue();
          return val.toJSDate();
        }
        default:
          return prop.getFirstValue().toString();
      }
    }
    return '';
  }

  async getIcsData(source?: string) {
    if (!source) {
      throw new Error(`getIcsData: source file not given`);
    }

    try {
      if (source.startsWith('http')) {
        // assume source is a url
        const resp = await axios(source);
        return resp?.data;
      } else {
        // assume is a file name
        return (await promises.readFile(source, 'utf-8')).toString();
      }
    } catch (err) {
      throw new Error(`getIcsData: ${err}`);
    }
  }
}
