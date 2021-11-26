import { flags } from '@oclif/command';
import { createWriteStream, existsSync } from 'fs';
import * as IcalExpander from 'ical-expander';
import * as moment from 'moment';
import { join } from 'path';
import { v4 } from 'uuid';

import { IcsorgBase } from './base';
import { Config, Event } from './types';

class Icsorg extends IcsorgBase {
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
  };

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

      of.write(`*** [[id:${event.id}][${event.summary}]]\n`);
      of.write(`${this.makeTimestampRange(event.startDate, event.endDate)}\n`);
      of.end();
    } catch (err) {
      throw new Error(`writeToDailyFile: ${err}`);
    }
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

    allEvents.forEach((e) => {
      this.createRoamFile(config, e);
      this.writeToDailyFile(config, e);
    });

    this.log(
      `Generated new org file in ${config.ORG_FILE} with ${allEvents.length} entries`,
    );
  }
}

export = Icsorg;
