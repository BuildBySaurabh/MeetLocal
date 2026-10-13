export type JoinIntent = 'create' | 'join';

/** Router location state passed from Home -> Join -> Meeting. */
export interface MeetingLocationState {
  intent?: JoinIntent;
}
