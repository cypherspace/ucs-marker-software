// Who runs this service and how to reach them, shown on the public pages (home, privacy, terms).
// Keep school- or operator-specific wording here rather than in the page text, so another school's deployment only has to
// change this file. Empty values show as a highlighted placeholder until they are filled in.
export const SITE = {
  appName: 'UCS Marking',
  // The organisation that runs the service, and a monitored mailbox for questions and deletion requests
  operatorName: 'Richard Wood',
  contactEmail: 'richard.wood@ucs.org.uk',
  // The school that uses it and is responsible for its pupils' data
  schoolName: 'UCS',
  hostingRegion: 'Google Cloud, London (europe-west2)',
  // While true the privacy and terms pages carry a "draft, not yet reviewed" notice listing what still has to be confirmed.
  // Set to false once the data protection lead has reviewed the text and the placeholders above are filled in.
  draft: true,
  lastUpdated: '18 November 2026',
} as const;
