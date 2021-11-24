import { Command, flags } from '@oclif/command';
import axios from 'axios';
import { config } from 'dotenv';
import { createWriteStream, existsSync, promises, WriteStream } from 'fs';
import * as IcalExpander from 'ical-expander';
import { capitalize } from 'lodash';
import { DateTime } from 'luxon';
import * as moment from 'moment';
import { join } from 'path';
import { v4 } from 'uuid';

type Event = any;
type Attendee = any;
type Occurence = any;

type Config = {
  RC_FILE: string;
  ICS_FILE: string;
  ORG_FILE: string;
  ROAM_PATH: string;
  DAILY_PATH: string;
  TITLE: string;
  AUTHOR: string;
  EMAIL: string;
  CATEGORY: string;
  STARTUP: string;
  FILETAGS: string;
  PAST: number;
  FUTURE: number;
  START_DATE: moment.Moment;
  END_DATE: moment.Moment;
};

class Icsorg extends Command {
  static description = 'describe the command here';

  static flags = {
    author: flags.string({
      char: 'a',
      description: 'Used for attendee matching',
    }),
    email: flags.string({
      char: 'e',
      description: 'Used for attendee matching',
    }),
    config_file: flags.string({
      char: 'c',
      description: 'Path to configuration file',
    }),
    roam_path: flags.string({
      char: 'r',
      description: 'Path to roam files',
    }),
    daily_path: flags.string({
      char: 'd',
      description: 'Path to daily files',
    }),
    input_file: flags.string({
      char: 'i',
      description: 'Path to the ICS file to use as input',
    }),
    output_file: flags.string({
      char: 'o',
      description: 'Path to the output file to be created (org file)',
    }),
    future_days: flags.integer({
      char: 'f',
      default: 365,
      description: 'Number of days into the future to include events from',
    }),
    past_days: flags.integer({
      char: 'p',
      default: 7,
      description: 'Number of days in the past to include events from',
    }),
    dump: flags.boolean({
      description: 'Dump the current configuration and exit',
    }),
    version: flags.version({
      char: 'v',
    }),
    help: flags.help({
      char: 'h',
    }),
    // name: flags.string({ char: 'n', description: 'name to print' }),
    // flag with no value (-f, --force)
    // force: flags.boolean({ char: 'f' }),
  };

  // static args = [{ name: 'file' }];

  logJson(value: any) {
    return this.log(JSON.stringify(value));
  }

  getConfigFile(flags: any) {
    return flags.config_file || `${process.env.HOME}/.icsorgrc`;
  }

  loadConfig(flags: any) {
    return config({ path: this.getConfigFile(flags) });
  }

  async run() {
    const { flags } = this.parse(Icsorg);
    this.loadConfig(flags);

    const config: Config = {
      RC_FILE: this.getConfigFile(flags),
      ICS_FILE: flags.input_file || process.env.ICS_FILE || '',
      ORG_FILE: flags.output_file || process.env.ORG_FILE || '',
      ROAM_PATH: flags.roam_path || process.env.ROAM_PATH || '',
      DAILY_PATH: flags.daily_path || process.env.DAILY_PATH || '',
      TITLE: process.env.TITLE || 'Calendar',
      AUTHOR: flags.author || process.env.AUTHOR || '',
      EMAIL: flags.email || process.env.EMAIL || '',
      CATEGORY: process.env.CATEGORY || '',
      STARTUP: process.env.STARTUP || '',
      FILETAGS: process.env.FILETAGS || '',
      PAST: process.env.PAST ? parseInt(process.env.PAST) : flags.past_days,
      FUTURE: process.env.FUTURE
        ? parseInt(process.env.FUTURE)
        : flags.future_days,
      START_DATE: moment(),
      END_DATE: moment(),
    };

    config.START_DATE = moment().subtract(config.PAST, 'days');
    config.END_DATE = moment().add(config.FUTURE, 'days');

    if (flags.dump) {
      let k: keyof typeof config;
      for (k in config) {
        this.log(`${k} = ${config[k]}`);
      }
      this.exit(0);
    }

    const data = await this.getIcsData(config.ICS_FILE);
    const expander = new IcalExpander({ ics: data, maxIterations: 1000 });
    const events = expander.between(
      config.START_DATE.toDate(),
      config.END_DATE.toDate(),
    );
    const mappedEvents = this.mapEvents(
      events.events,
      config.AUTHOR,
      config.EMAIL,
    );
    const mappedOccurrences = this.mapOccurences(
      events.occurrences,
      config.AUTHOR,
      config.EMAIL,
    );

    let allEvents = [...mappedEvents, ...mappedOccurrences];
    allEvents = allEvents.map((e) => {
      e.id = v4();
      return e;
    });

    this.createOrgFile(config, allEvents);

    allEvents.forEach((e) => {
      this.createRoamFile(config, e);
      this.writeToDailyFile(config, e);
    });

    console.log(
      `Generated new org file in ${config.ORG_FILE} with ${allEvents.length} entries`,
    );
  }

  createOrgFile(config: Config, events: Event[]) {
    const header = [
      `#+TITLE:       ${config.TITLE}\n`,
      `#+AUTHOR:      ${config.AUTHOR}\n`,
      `#+EMAIL:       ${config.EMAIL}\n`,
      '#+DESCRIPTION: converted using icsorg node script\n',
      `#+CATEGORY:    ${config.CATEGORY}\n`,
      `#+STARTUP:     ${config.STARTUP}\n`,
      `#+FILETAGS:    ${config.FILETAGS}\n`,
      '\n',
    ];

    try {
      const of = createWriteStream(config.ORG_FILE, {
        encoding: 'utf-8',
        flags: 'w',
      });
      header.forEach((h) => of.write(h));
      events.forEach((e) => this.dumpEvent(e, of));
      of.end();
    } catch (err) {
      throw new Error(`createOrgFile: ${err}`);
    }
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

  createRoamFile(config: Config, event: Event) {
    try {
      const timestamp = moment(event.startDate).format('YYYYMMDDhhmmss');
      const slug = event.summary.replace(/[\W_]+/g, '_').toLowerCase();
      const filename = join(config.ROAM_PATH, `${timestamp}-${slug}.org`);
      const of = createWriteStream(filename, {
        encoding: 'utf-8',
        flags: 'w',
      });
      this.dumpEvent(event, of, true);
      of.end();
    } catch (err) {
      throw new Error(`createOrgFile: ${err}`);
    }
  }

  writeToDailyFile(config: Config, event: Event) {
    const timestamp = moment(event.startDate).format('YYYY-MM-DD');
    const filename = join(config.DAILY_PATH, `${timestamp}.org`);

    if (!existsSync(filename)) {
      try {
        const of = createWriteStream(filename, {
          encoding: 'utf-8',
          flags: 'w',
        });

        of.write(`:PROPERTIES:
:ID:       ${v4()}
:END:
#+title: ${timestamp}
* Daily Log for: ${timestamp}
** Calendar Events
`);
        of.end();
      } catch (err) {
        throw new Error(`writeToDailyFile: ${err}`);
      }
    }

    try {
      const of = createWriteStream(filename, {
        encoding: 'utf-8',
        flags: 'a',
      });

      of.write(`- [[id:${event.id}][${event.summary}]]\n`);
      of.write(
        `  ${this.makeTimestampRange(event.startDate, event.endDate)}\n`,
      );
      of.end();
    } catch (err) {
      throw new Error(`writeToDailyFile: ${err}`);
    }
  }

  mapOccurences(occurrences: any, author?: string, email?: string) {
    const mappedOccurrences = occurrences.map((o: Occurence) => ({
      startDate: o.startDate.toJSDate(),
      endDate: o.endDate.toJSDate(),
      ...this.commonEventProperties(o.item, author, email),
    }));
    return mappedOccurrences;
  }

  mapEvents(events: any, author?: string, email?: string) {
    const mappedEvents = events.map((e: Event) => ({
      endDate: e.endDate.toJSDate(),
      startDate: e.startDate.toJSDate(),
      ...this.commonEventProperties(e, author, email),
    }));
    return mappedEvents;
  }

  commonEventProperties(e: any, author?: string, email?: string) {
    return {
      attendees: e.attendees.map(
        (a: Attendee) => this.parseAttendee(a.jCal[1]),
        author,
        email,
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

export = Icsorg;
