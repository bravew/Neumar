/**
 * The project templates a user can pick.
 *
 * The choice is not cosmetic: `assertStoryboardWithinTemplateLimits` on the
 * server refuses to approve a storyboard longer than the template allows —
 * 15s for `ugc-ad`, 60s for the themed ones, unlimited for `custom`.
 */
export { VIDEO_PROJECT_TEMPLATES as PROJECT_TEMPLATES } from '@/shared/video/projectTemplates';
