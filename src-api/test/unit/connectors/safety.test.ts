import { describe, expect, it } from 'vitest';

import { classifyConnectorToolSafety } from '@/shared/connectors/catalog';

describe('classifyConnectorToolSafety', () => {
  it.each([
    ['github_delete_repository', 'destructive', 'disabled'],
    ['slack_revoke_app_token', 'destructive', 'disabled'],
    ['github_delete_issue_comment', 'write', 'confirm'],
    ['notion_create_page', 'write', 'confirm'],
    ['gmail_send_message', 'write', 'confirm'],
    ['linear_get_issue', 'read', 'auto'],
    ['drive_list_files', 'read', 'auto'],
    ['mystery_action', 'write', 'confirm'],
  ] as const)(
    'classifies %s as %s/%s',
    (name, expectedSideEffect, expectedApproval) => {
      expect(classifyConnectorToolSafety({ name })).toMatchObject({
        sideEffect: expectedSideEffect,
        approval: expectedApproval,
      });
    },
  );

  it('lets write scope hints override read-only name hints', () => {
    expect(
      classifyConnectorToolSafety({
        name: 'read_only_audit',
        requiredScopes: ['admin:write'],
      }),
    ).toMatchObject({
      sideEffect: 'write',
      approval: 'confirm',
    });
  });

  it('uses description and title hints when the name is ambiguous', () => {
    expect(
      classifyConnectorToolSafety({
        name: 'repository_action',
        title: 'Delete repository',
        description: 'Remove the entire repository and all settings.',
      }),
    ).toMatchObject({
      sideEffect: 'destructive',
      approval: 'disabled',
    });
  });
});
