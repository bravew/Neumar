// Google Workspace sub-services that can be enabled with incremental scopes.
export const GOOGLE_SERVICES = [
  {
    id: 'gmail',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ],
  },
  {
    id: 'calendar',
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  },
  {
    id: 'drive',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
  },
  {
    id: 'photos',
    scopes: [
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
    ],
  },
  {
    id: 'meet',
    scopes: [
      'https://www.googleapis.com/auth/meetings.space.created',
      'https://www.googleapis.com/auth/meetings.space.readonly',
    ],
  },
  {
    id: 'docs',
    scopes: ['https://www.googleapis.com/auth/documents'],
  },
  {
    id: 'sheets',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  },
  // {
  //   id: 'tasks',
  //   scopes: ['https://www.googleapis.com/auth/tasks'],
  // },
  {
    id: 'contacts',
    scopes: ['https://www.googleapis.com/auth/contacts'],
  },
  {
    id: 'directory',
    scopes: ['https://www.googleapis.com/auth/directory.readonly'],
  },
] as const;
