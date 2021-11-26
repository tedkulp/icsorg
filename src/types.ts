export type Event = any;
export type Attendee = any;
export type Occurence = any;

export type Config = {
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
