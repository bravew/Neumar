import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all Google integration modules
vi.mock('@/shared/integrations/google/gmail', () => ({
  listMessages: vi.fn().mockResolvedValue({
    messages: [
      {
        id: 'msg1',
        threadId: 'thread1',
        snippet: 'Test email',
        subject: 'Hello',
        from: 'alice@test.com',
        to: 'bob@test.com',
        date: '2024-01-01',
        body: 'Email body content',
        labels: ['INBOX'],
      },
    ],
    nextPageToken: undefined,
    resultSizeEstimate: 1,
  }),
  getMessage: vi.fn().mockResolvedValue({
    id: 'msg1',
    threadId: 'thread1',
    snippet: 'Test email',
    subject: 'Hello',
    from: 'alice@test.com',
    to: 'bob@test.com',
    date: '2024-01-01',
    body: 'Email body content',
    labels: ['INBOX'],
  }),
  searchMessages: vi.fn().mockResolvedValue({
    messages: [],
    nextPageToken: undefined,
    resultSizeEstimate: 0,
  }),
  sendMessage: vi.fn().mockResolvedValue({ id: 'sent1', threadId: 'thread1' }),
  getUnreadCount: vi.fn().mockResolvedValue(5),
}));

vi.mock('@/shared/integrations/google/calendar', () => ({
  listCalendars: vi
    .fn()
    .mockResolvedValue([
      { id: 'primary', summary: 'My Calendar', primary: true },
    ]),
  listEvents: vi.fn().mockResolvedValue([
    {
      id: 'evt1',
      summary: 'Meeting',
      start: { dateTime: '2024-01-01T10:00:00Z' },
      end: { dateTime: '2024-01-01T11:00:00Z' },
      status: 'confirmed',
      htmlLink: 'https://calendar.google.com/event/evt1',
    },
  ]),
  getEvent: vi.fn().mockResolvedValue({
    id: 'evt1',
    summary: 'Meeting',
    start: { dateTime: '2024-01-01T10:00:00Z' },
    end: { dateTime: '2024-01-01T11:00:00Z' },
  }),
  createEvent: vi.fn().mockResolvedValue({
    id: 'evt2',
    summary: 'New Event',
    htmlLink: 'https://calendar.google.com/event/evt2',
  }),
  getTodaySchedule: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/shared/integrations/google/drive', () => ({
  listFiles: vi.fn().mockResolvedValue({
    files: [{ id: 'file1', name: 'test.txt', mimeType: 'text/plain' }],
  }),
  searchFiles: vi.fn().mockResolvedValue({ files: [] }),
  getFile: vi.fn().mockResolvedValue({
    id: 'file1',
    name: 'test.txt',
    mimeType: 'text/plain',
  }),
  downloadFileContent: vi.fn().mockResolvedValue('file content here'),
  getRecentFiles: vi.fn().mockResolvedValue([]),
  createFile: vi.fn().mockResolvedValue({
    id: 'newfile1',
    name: 'new.txt',
    mimeType: 'text/plain',
    webViewLink: 'https://drive.google.com/file/newfile1',
  }),
  createFolder: vi.fn().mockResolvedValue({
    id: 'folder1',
    name: 'New Folder',
    mimeType: 'application/vnd.google-apps.folder',
  }),
  updateFileMetadata: vi.fn().mockResolvedValue({
    id: 'file1',
    name: 'renamed.txt',
  }),
  copyFile: vi.fn().mockResolvedValue({ id: 'copy1', name: 'copy.txt' }),
  trashFile: vi.fn().mockResolvedValue({ id: 'file1', name: 'test.txt' }),
  untrashFile: vi.fn().mockResolvedValue({ id: 'file1', name: 'test.txt' }),
  moveFile: vi.fn().mockResolvedValue({ id: 'file1', name: 'test.txt' }),
  exportFile: vi.fn().mockResolvedValue('exported content'),
  uploadFileContent: vi.fn().mockResolvedValue({
    id: 'upload1',
    name: 'uploaded.txt',
  }),
  listComments: vi.fn().mockResolvedValue([
    {
      id: 'comment1',
      content: 'Nice work!',
      author: { displayName: 'Alice' },
      createdTime: '2024-01-01T00:00:00Z',
      resolved: false,
      replies: [],
    },
  ]),
  createComment: vi.fn().mockResolvedValue({ id: 'comment2' }),
  replyToComment: vi.fn().mockResolvedValue({ id: 'reply1' }),
  resolveComment: vi.fn().mockResolvedValue({ id: 'reply2' }),
  listPermissions: vi.fn().mockResolvedValue([
    {
      id: 'perm1',
      type: 'user',
      role: 'writer',
      emailAddress: 'alice@test.com',
    },
  ]),
  shareFile: vi.fn().mockResolvedValue({
    id: 'perm2',
    type: 'user',
    role: 'reader',
    emailAddress: 'bob@test.com',
  }),
  updatePermission: vi.fn().mockResolvedValue({
    id: 'perm1',
    role: 'reader',
  }),
  removePermission: vi.fn().mockResolvedValue(undefined),
  listRevisions: vi.fn().mockResolvedValue([
    {
      id: 'rev1',
      mimeType: 'text/plain',
      modifiedTime: '2024-01-01T00:00:00Z',
    },
  ]),
}));

vi.mock('@/shared/integrations/google/photos', () => ({
  startPhotoPicker: vi.fn().mockResolvedValue({
    sessionId: 'session1',
    pickerUrl: 'https://photos.google.com/picker/session1',
    pollIntervalMs: 5000,
    timeoutMs: 1800000,
  }),
  getSession: vi.fn().mockResolvedValue({
    id: 'session1',
    mediaItemsSet: true,
  }),
  listPickedMediaItems: vi.fn().mockResolvedValue({
    mediaItems: [],
    nextPageToken: undefined,
  }),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/integrations/google/meet', () => ({
  createSpace: vi.fn().mockResolvedValue({
    name: 'spaces/abc123',
    meetingUri: 'https://meet.google.com/abc-defg-hij',
    meetingCode: 'abc-defg-hij',
  }),
  getSpace: vi.fn().mockResolvedValue({
    name: 'spaces/abc123',
    meetingUri: 'https://meet.google.com/abc-defg-hij',
    meetingCode: 'abc-defg-hij',
  }),
  updateSpace: vi.fn().mockResolvedValue({
    name: 'spaces/abc123',
    config: { accessType: 'TRUSTED' },
  }),
  endActiveConference: vi.fn().mockResolvedValue(undefined),
  listConferenceRecords: vi.fn().mockResolvedValue([
    {
      name: 'conferenceRecords/rec1',
      startTime: '2024-01-01T10:00:00Z',
      endTime: '2024-01-01T11:00:00Z',
      space: 'spaces/abc123',
    },
  ]),
  getConferenceRecord: vi.fn().mockResolvedValue({
    name: 'conferenceRecords/rec1',
    startTime: '2024-01-01T10:00:00Z',
  }),
  listParticipants: vi.fn().mockResolvedValue([
    {
      name: 'conferenceRecords/rec1/participants/p1',
      signedinUser: { displayName: 'Alice' },
    },
  ]),
  listRecordings: vi.fn().mockResolvedValue([]),
  getRecording: vi.fn().mockResolvedValue({
    name: 'conferenceRecords/rec1/recordings/r1',
    state: 'ENDED',
  }),
  listTranscripts: vi.fn().mockResolvedValue([]),
  listTranscriptEntries: vi.fn().mockResolvedValue([
    {
      name: 'entry1',
      participant: 'p1',
      text: 'Hello everyone',
      languageCode: 'en',
      startTime: '2024-01-01T10:00:00Z',
      endTime: '2024-01-01T10:00:05Z',
    },
  ]),
}));

// Mock oauth-client (not used directly but needed by integrations at import time)
vi.mock('@/shared/auth/oauth-client', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue('mock-token'),
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  LOG_FILE_PATH: '/tmp/test.log',
  getLogFilePath: () => '/tmp/test.log',
}));

// All scopes for testing with full access
const ALL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/directory.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/documents',
];

describe('Google MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates server with all 79 tools when all scopes granted', async () => {
    const { createGoogleMcpServer, ALL_GOOGLE_TOOL_NAMES } =
      await import('@/shared/mcp/google-server');

    const server = createGoogleMcpServer(ALL_SCOPES);
    expect(server).toBeDefined();
    expect(ALL_GOOGLE_TOOL_NAMES.length).toBe(79);
  });

  it('has correct tool name prefixes', async () => {
    const { ALL_GOOGLE_TOOL_NAMES } =
      await import('@/shared/mcp/google-server');

    const gmailTools = ALL_GOOGLE_TOOL_NAMES.filter((n: string) =>
      n.startsWith('google_gmail_'),
    );
    const calendarTools = ALL_GOOGLE_TOOL_NAMES.filter((n: string) =>
      n.startsWith('google_calendar_'),
    );
    const driveTools = ALL_GOOGLE_TOOL_NAMES.filter((n: string) =>
      n.startsWith('google_drive_'),
    );
    const photosTools = ALL_GOOGLE_TOOL_NAMES.filter((n: string) =>
      n.startsWith('google_photos_'),
    );
    const meetTools = ALL_GOOGLE_TOOL_NAMES.filter((n: string) =>
      n.startsWith('google_meet_'),
    );

    expect(gmailTools.length).toBe(5);
    expect(calendarTools.length).toBe(5);
    expect(driveTools.length).toBe(23);
    expect(photosTools.length).toBe(4);
    expect(meetTools.length).toBe(11);
  });

  it('has unique tool names', async () => {
    const { ALL_GOOGLE_TOOL_NAMES } =
      await import('@/shared/mcp/google-server');
    const unique = new Set(ALL_GOOGLE_TOOL_NAMES);
    expect(unique.size).toBe(ALL_GOOGLE_TOOL_NAMES.length);
  });

  it('describes Google Photos tools as picker-only, not publish tools', async () => {
    const { googleTools } = await import('@/shared/mcp/google-server');
    const descriptions = Object.fromEntries(
      googleTools
        .filter((toolDef) => toolDef.name.startsWith('google_photos_'))
        .map((toolDef) => [toolDef.name, toolDef.description]),
    );

    expect(descriptions.google_photos_start_picker).toContain('picker');
    expect(descriptions.google_photos_start_picker).toContain('cannot upload');
    expect(descriptions.google_photos_start_picker).toContain('publish MCP');
    expect(descriptions.google_photos_delete_session).toContain(
      'PICKER CLEANUP ONLY',
    );
    expect(descriptions.google_photos_delete_session).toContain(
      'does not delete photos',
    );
  });

  it('all tool names follow the google_ prefix convention', async () => {
    const { ALL_GOOGLE_TOOL_NAMES } =
      await import('@/shared/mcp/google-server');
    for (const name of ALL_GOOGLE_TOOL_NAMES) {
      expect(name).toMatch(/^google_/);
    }
  });

  it('filters tools by granted scopes — only calendar', async () => {
    const { getGoogleToolNames } = await import('@/shared/mcp/google-server');
    const calendarOnly = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ];
    const names = getGoogleToolNames(calendarOnly);
    expect(names.length).toBe(5);
    expect(names.every((n: string) => n.startsWith('google_calendar_'))).toBe(
      true,
    );
  });

  it('returns zero tools when no service scopes granted', async () => {
    const { getGoogleToolNames } = await import('@/shared/mcp/google-server');
    const names = getGoogleToolNames(['openid', 'email', 'profile']);
    expect(names.length).toBe(0);
  });

  it('returns all 79 tools when all scopes granted', async () => {
    const { getGoogleToolNames } = await import('@/shared/mcp/google-server');
    const names = getGoogleToolNames(ALL_SCOPES);
    expect(names.length).toBe(79);
  });
});
