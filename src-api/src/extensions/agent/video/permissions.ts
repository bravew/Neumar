import type { ToolClassification } from '@/core/agent/tool-permission-registry';
import type { AgentOptions } from '@/core/agent/types';

const READ_TOOLS = [
  'video_get_project_summary',
  'video_get_current_context',
  'video_get_scene',
  'video_get_timeline',
  'video_get_timeline_window',
  'video_inspect_timeline_frames',
  'video_find_clips',
  'video_list_assets',
  'video_describe_scene',
  'video_search_assets',
  'video_search_linked_assets',
  'video_rank_moments',
  'video_list_transition_presets',
  'video_list_overlay_presets',
  'video_get_transition_seams',
  'video_list_engines',
  'video_search_templates',
  'video_list_custom_templates',
  'video_inspect_template',
  'video_fetch_source',
  'video_get_content_graph',
  'video_analyze_assets',
  'video_get_handoff_conformance',
  'video_search_frames',
] as const;

const WRITE_TOOLS = [
  'video_analyze_image',
  'video_set_aspect_ratio',
  'video_add_scene',
  'video_set_caption',
  'video_set_transition',
  'video_set_timeline_transition',
  'video_update_timeline_transition',
  'video_remove_timeline_transition',
  'video_set_timeline_bookend',
  'video_clear_timeline_bookend',
  'video_set_clip_audio_seam',
  'video_set_keyframes',
  // In-place overlay/effect param edits — journaled and undoable, never structural.
  'video_set_overlay_controls',
  'video_set_overlay_control_keyframes',
  'video_apply_overlay_motion_template',
  'video_set_clip_params',
  // Saves a data-only bookmark to the user's overlay library — reversible via UI delete.
  'video_save_overlay_preset',
  'video_save_overlay_style_from_template',
  'video_save_user_overlay_document',
  'video_apply_timeline_op',
  'video_apply_timeline_ops',
  'video_undo_timeline_op',
  'video_redo_timeline_op',
  'video_add_captions',
  'video_generate_captions',
  'video_add_lower_third',
  'video_attach_asset',
  'video_estimate_plan',
  'video_select_template',
  'video_record_research_brief',
  'video_save_as_template',
  'video_write_content_graph',
  'video_write_frame_html',
  'video_set_frame_native_enhancement',
  'video_draft_narration',
  'video_export_editor_handoff',
  // Commits the storyboard so it can be rendered. Reversible — any later edit
  // reverts the status to "edited" — so it is a write, not destructive.
  'video_approve_storyboard',
] as const;

const DESTRUCTIVE_TOOLS = [
  'video_remove_scene',
  'video_split_scene',
  'video_reorder_scenes',
  'video_set_duration',
  'video_trim_clip',
  'video_remove_filler_words',
  'video_tighten_pacing',
  'video_duck_audio',
  'video_regenerate_scene',
  'video_generate_broll',
  'video_generate_audio',
  'video_transform_audio',
  'video_generate_voiceover',
  'video_generate_music',
  'video_reframe',
  'video_restyle',
  'video_translate',
  'video_render',
  'video_cancel_render',
  'video_verify_render',
  'video_publish_to',
  'video_import_youtube',
  'video_apply_capture_to_timeline',
  'video_propose_timeline_ops',
  'video_suggest_timeline_transitions',
  'video_cut_clip',
  'video_cut_range',
  'video_duplicate_clips',
  'video_delete_clips',
  'video_move_clips',
  'video_set_clip_speed',
  'video_reverse_clip',
  'video_rotate_clip',
  'video_flip_clip',
  'video_set_clip_transform',
  'video_close_gap',
  'video_set_audio_clip_gain',
  'video_set_audio_clip_mute',
  'video_set_audio_clip_fade',
  'video_set_audio_track_volume',
  'video_set_audio_track_mute',
  'video_set_audio_transition',
  'video_crossfade_audio_clips',
  'video_set_audio_volume_keyframes',
  'video_replace_audio_clip_source',
] as const;

const METERED_TOOLS = new Set([
  'mcp__media__media_generate_image',
  'mcp__media__media_generate_video',
  'mcp__video-edit__video_generate_broll',
  'mcp__video-edit__video_generate_audio',
  'mcp__video-edit__video_transform_audio',
  'mcp__video-edit__video_generate_voiceover',
  'mcp__video-edit__video_generate_music',
]);

export type VideoToolCostClass = 'free' | 'metered';

export function buildVideoToolClassifications(): NonNullable<
  AgentOptions['toolClassifications']
> {
  const entries: Array<[string, ToolClassification]> = [
    ...READ_TOOLS.map((name): [string, ToolClassification] => [
      `mcp__video-edit__${name}`,
      'read',
    ]),
    ...WRITE_TOOLS.map((name): [string, ToolClassification] => [
      `mcp__video-edit__${name}`,
      'write',
    ]),
    ...DESTRUCTIVE_TOOLS.map((name): [string, ToolClassification] => [
      `mcp__video-edit__${name}`,
      'destructive',
    ]),
    // Generative media tools — cost money, ask the user
    ['mcp__media__media_generate_image', 'destructive'],
    ['mcp__media__media_generate_video', 'destructive'],
    // Read-only media tools — auto-allow so render-verify loops don't prompt
    ['mcp__media__media_check_video', 'read'],
    ['mcp__media__media_list_capabilities', 'read'],
    // Mutates global materialization limits; ask the user even though the tool
    // is implemented as a settings update.
    ['mcp__assets__assets_request_budget_increase', 'destructive'],
    // YouTube acquisition is high-risk and only becomes available when the
    // plugin capability gate grants network:youtube.
    ['mcp__broll__youtube', 'destructive'],
    // Research tools — read-only network lookups; auto-allow so the agent can
    // pull references (template ideas, color theory, music licensing, etc.)
    // without a permission prompt on every query.
    ['WebSearch', 'read'],
    ['WebFetch', 'read'],
    ['Read', 'read'],
  ];
  return Object.fromEntries(entries);
}

export function getVideoToolCostClass(toolName: string): VideoToolCostClass {
  return METERED_TOOLS.has(toolName) ? 'metered' : 'free';
}
