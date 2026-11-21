export default {
  title: 'Video downloads',
  itemLabel: 'Video {n}',
  summary: '{saved} of {total} saved',
  waiting: 'Waiting to start',
  queued: 'Queued',
  transferring: 'Downloading',
  postprocessing: 'Finishing file',
  saved: 'Saved',
  failed: 'Failed',
  cancelled: 'Cancelled',
  progressUnknown: '{done} downloaded',
  progressKnown: '{done} of {total}',
  speed: '{rate}/s',
  eta: '{time} left',
  reasonUnavailable: 'This video is unavailable.',
  reasonDenied: 'Saving to this folder is not allowed.',
  reasonLimit: 'Over the download limit.',
  reasonCollision: 'A file with this name already exists.',
  reasonDownload: 'The download failed.',
  playerUnavailable:
    'This video can’t be played here. The format may be unsupported, or the file was moved or access changed.',
  destination: {
    question: 'Where should the videos be saved?',
    chooseFolder: 'Choose another folder',
    hint: 'Pick any folder you have allowed this task to write.',
    browserHint:
      'Folder picking needs the desktop app. Choose a folder the task already has access to.',
    pickFailed:
      'That folder could not be checked. Choose one of the folders above.',
  },
};
