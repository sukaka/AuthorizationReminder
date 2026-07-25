import { expect, it } from 'vitest';

import {
  buildWorkspaceSearch,
  readWorkspaceLocation,
  type WorkspaceLocation,
} from '../src/navigation/workspaceLocation';

it('defaults unknown workspace locations to chat', () => {
  expect(readWorkspaceLocation('?page=unknown&session=session-1')).toMatchObject({
    page: 'chat',
    sessionUuid: 'session-1',
    projectUuid: '',
  });
});

it('restores a project conversation from a shareable location', () => {
  expect(readWorkspaceLocation('?session=session-1&project=project-1')).toMatchObject({
    page: 'chat',
    sessionUuid: 'session-1',
    projectUuid: 'project-1',
  });
});

it('infers task, artifact, workflow and deliverable destinations from focused ids', () => {
  expect(readWorkspaceLocation('?run=run-1').page).toBe('tasks');
  expect(readWorkspaceLocation('?artifact=artifact-1')).toMatchObject({
    page: 'history',
    historyTab: 'agent',
  });
  expect(readWorkspaceLocation('?workflow=workflow-1').page).toBe('workflows');
  expect(readWorkspaceLocation('?deliverable=deliverable-1').page).toBe('professional-deliverables');
});

it('serializes only the focus fields used by the current page', () => {
  const location: WorkspaceLocation = {
    page: 'tasks',
    sessionUuid: 'session-hidden',
    projectUuid: 'project-hidden',
    runId: 'run-visible',
    artifactId: 'artifact-hidden',
    workflowId: 'workflow-hidden',
    deliverableId: 'deliverable-hidden',
    historyTab: 'agent',
  };

  expect(buildWorkspaceSearch(location)).toBe('?page=tasks&run=run-visible');
  expect(buildWorkspaceSearch({
    ...location,
    page: 'chat',
  })).toBe('?session=session-hidden&project=project-hidden');
});
