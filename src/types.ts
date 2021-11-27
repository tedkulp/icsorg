import { DateTime } from 'luxon';

export type Attendee = {
  role: string;
  status: string;
  cn: string;
  guests: string;
  me: boolean;
};

export type ExpanderAttendee = Attendee & {
  jCal: any[];
};

export type Event = {
  endDate: Date;
  startDate: Date;
  attendees: Attendee[];
  description: string;
  duration: {
    weeks: number;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isNegative: boolean;
  };
  location: string;
  organizer: string;
  uid: string;
  status: string;
  modified: Date;
  summary: string;
  id?: string;
};

export type ExpanderEvent = Event & {
  endDate: DateTime;
  startDate: DateTime;
  attendees: ExpanderAttendee[];
  author: string;
  email: string;
  component: any;
};

export type ExpanderOccurence = {
  endDate: DateTime;
  startDate: DateTime;
  item: ExpanderEvent;
};

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
