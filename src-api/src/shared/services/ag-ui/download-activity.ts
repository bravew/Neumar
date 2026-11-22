import { EventType, type ActivitySnapshotEvent } from '@ag-ui/core';
import {
  downloadActivityId,
  downloadActivitySchema,
  MEDIA_DOWNLOAD_ACTIVITY,
  type DownloadActivity,
} from '@neumar/video-ir';

/** A complete replacement survives reconnect even when a progress tick is missed. */
export function downloadActivityEvent(
  activity: DownloadActivity,
): ActivitySnapshotEvent {
  const content = downloadActivitySchema.parse(activity);
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: downloadActivityId(content),
    activityType: MEDIA_DOWNLOAD_ACTIVITY,
    replace: true,
    content,
  };
}
