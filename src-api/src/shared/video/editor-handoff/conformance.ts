import type {
  ConformanceIssue,
  ConformanceIssueCode,
  ConformanceReport,
  ConformanceSeverity,
  EditorHandoffModel,
  EditorHandoffTarget,
  TargetConformanceSummary,
} from './types';

const UNVERIFIED_TARGETS = new Set<EditorHandoffTarget>([
  'final-cut-pro',
  'premiere-pro',
  'resolve',
  'otio',
  'edl',
  'capcut-fallback',
]);

const EXTERNAL_TARGETS = new Set<EditorHandoffTarget>([
  'final-cut-pro',
  'premiere-pro',
  'resolve',
  'otio',
  'edl',
  'capcut-fallback',
]);

const FLATTENED_OVERLAY_TARGETS = new Set<EditorHandoffTarget>([
  'premiere-pro',
  'resolve',
  'edl',
  'capcut-fallback',
]);

const REDUCED_CAPTION_TARGETS = new Set<EditorHandoffTarget>([
  'premiere-pro',
  'resolve',
  'edl',
  'capcut-fallback',
]);

export function evaluateHandoffConformance(
  model: EditorHandoffModel,
  targets: EditorHandoffTarget[],
  generatedAt = new Date().toISOString(),
): ConformanceReport {
  const issues: ConformanceIssue[] = [];

  for (const target of targets) {
    if (UNVERIFIED_TARGETS.has(target)) {
      issues.push(
        issue('target_unverified', 'warning', {
          target,
          message:
            'This target is generated but not marked supported until import-matrix.md records a manual import.',
        }),
      );
    }
    if (target === 'capcut-fallback') {
      issues.push(
        issue('capcut_fallback_only', 'warning', {
          target,
          message:
            'CapCut direct project export is not supported; this package provides media, captions, and reference interchange only.',
        }),
      );
    }
  }

  for (const mediaId of model.featureMap.missingMediaIds) {
    issues.push(
      issue('missing_media', 'error', {
        mediaId,
        message: `Media "${mediaId}" is missing or only referenced; relink will be required.`,
      }),
    );
  }

  for (const mediaRef of model.mediaRefs) {
    if (!mediaRef.missing && mediaRef.relinkRequired) {
      issues.push(
        issue('media_relink_required', 'warning', {
          mediaId: mediaRef.id,
          message: `Media "${mediaRef.id}" is linked and may require relinking in the target editor.`,
        }),
      );
    }
  }

  for (const derivativeId of model.featureMap.derivativeMissingIds) {
    issues.push(
      issue('derivative_missing', 'warning', {
        message: `Derivative "${derivativeId}" is missing and will be omitted from the package.`,
      }),
    );
  }

  for (const target of targets.filter((target) =>
    EXTERNAL_TARGETS.has(target),
  )) {
    addFeatureIssues(model, target, issues);
  }

  return {
    generatedAt,
    targets,
    issues,
    summary: summarize(targets, issues),
  };
}

function addFeatureIssues(
  model: EditorHandoffModel,
  target: EditorHandoffTarget,
  issues: ConformanceIssue[],
): void {
  const featureMap = model.featureMap;
  if (featureMap.hasUnsupportedEffects) {
    issues.push(
      issue('flattened_effect', 'warning', {
        target,
        message:
          'Unsupported timeline effect clips are flattened or reported as metadata for this target.',
      }),
    );
  }
  if (featureMap.unsupportedTransitions.length > 0) {
    issues.push(
      issue('unsupported_transition', 'warning', {
        target,
        message: `Unsupported transitions may degrade: ${featureMap.unsupportedTransitions.join(', ')}.`,
      }),
    );
  }
  if (featureMap.hasCaptionStyle && REDUCED_CAPTION_TARGETS.has(target)) {
    issues.push(
      issue('caption_style_degraded', 'warning', {
        target,
        message:
          'Caption text transfers, but custom caption styling may degrade.',
      }),
    );
  }
  if (featureMap.hasOverlays && FLATTENED_OVERLAY_TARGETS.has(target)) {
    issues.push(
      issue('overlay_flattened', 'warning', {
        target,
        message:
          'Overlay or b-roll tracks may need manual reconstruction after import.',
      }),
    );
  }
  if (featureMap.hasSpeedChanges) {
    issues.push(
      issue('speed_change_degraded', 'warning', {
        target,
        message:
          'Speed changes are represented as metadata and may need manual recreation.',
      }),
    );
  }
  if (featureMap.hasReversePlayback) {
    issues.push(
      issue('reverse_playback_degraded', 'warning', {
        target,
        message: 'Reverse playback is not guaranteed to transfer.',
      }),
    );
  }
  if (featureMap.hasFreezeFrames) {
    issues.push(
      issue('freeze_frame_flattened', 'warning', {
        target,
        message: 'Freeze frames are flattened or represented as edit notes.',
      }),
    );
  }
  if (featureMap.hasStabilization) {
    issues.push(
      issue('stabilization_flattened', 'warning', {
        target,
        message:
          'Stabilization metadata is included, but editor-specific stabilization is not recreated.',
      }),
    );
  }
  if (featureMap.hasMotionTracking) {
    issues.push(
      issue('motion_tracking_not_transferable', 'warning', {
        target,
        message:
          'Motion tracking data is not transferable through interchange XML.',
      }),
    );
  }
  if (featureMap.hasUnsupportedBlendModes) {
    issues.push(
      issue('unsupported_blend_mode', 'warning', {
        target,
        message: 'Unsupported blend modes may render differently after import.',
      }),
    );
  }
  if (featureMap.hasColorGrades) {
    issues.push(
      issue('color_grade_degraded', 'warning', {
        target,
        message:
          'Color filters and grades are recorded but may not transfer exactly.',
      }),
    );
  }
  if (featureMap.hasKeyframeCurves) {
    issues.push(
      issue('keyframe_curve_degraded', 'warning', {
        target,
        message: 'Keyframe curve interpolation may degrade in this target.',
      }),
    );
  }
  if (hasAudioEditMetadata(featureMap)) {
    issues.push(
      issue('audio_edit_metadata_degraded', 'warning', {
        target,
        message:
          'Audio gain, fades, mute state, ducking, transitions, or generated provenance are included as metadata and may need manual verification after import.',
      }),
    );
  }
}

function hasAudioEditMetadata(
  featureMap: EditorHandoffModel['featureMap'],
): boolean {
  return (
    featureMap.hasAudioGain ||
    featureMap.hasAudioFades ||
    featureMap.hasAudioMute ||
    featureMap.hasAudioTrackVolume ||
    featureMap.hasAudioTransitions ||
    featureMap.hasAudioDucking ||
    featureMap.hasGeneratedAudio
  );
}

function issue(
  code: ConformanceIssueCode,
  severity: ConformanceSeverity,
  input: Omit<ConformanceIssue, 'id' | 'code' | 'severity'>,
): ConformanceIssue {
  const targetSuffix = input.target ? `:${input.target}` : '';
  const subject =
    input.clipId ??
    input.trackId ??
    input.mediaId ??
    input.message.slice(0, 24);
  return {
    id: `${code}${targetSuffix}:${subject}`,
    code,
    severity,
    ...input,
  };
}

function summarize(
  targets: EditorHandoffTarget[],
  issues: ConformanceIssue[],
): ConformanceReport['summary'] {
  const targetSummaries: TargetConformanceSummary[] = targets.map((target) => {
    const targetIssues = issues.filter(
      (item) => item.target === target || item.target === undefined,
    );
    return {
      target,
      support:
        target === 'neuma-package'
          ? 'supported'
          : target === 'capcut-fallback'
            ? 'fallback-only'
            : 'generated-unverified',
      issueCount: targetIssues.length,
      warningCount: targetIssues.filter((item) => item.severity === 'warning')
        .length,
      errorCount: targetIssues.filter((item) => item.severity === 'error')
        .length,
    };
  });
  return {
    issueCount: issues.length,
    warningCount: issues.filter((item) => item.severity === 'warning').length,
    errorCount: issues.filter((item) => item.severity === 'error').length,
    unsupportedFeatureCount: issues.filter(
      (item) =>
        item.code !== 'target_unverified' &&
        item.code !== 'media_relink_required',
    ).length,
    targets: targetSummaries,
  };
}
