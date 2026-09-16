import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStep } from '../src/domain/evaluateStep.js';

function approvers(n) {
  return Array.from({ length: n }, (_, i) => ({ emp_id: `A${i + 1}` }));
}

function decide(empId, action, { recalled = false } = {}) {
  return { emp_id: empId, action, recalledAt: recalled ? new Date() : undefined };
}

test('1 of 1: the one approver approving -> passed', () => {
  const step = { quorum: 1, approvers: approvers(1) };
  assert.equal(evaluateStep(step, [decide('A1', 'approve')]), 'passed');
});

test('1 of 1: the one approver rejecting -> failed', () => {
  const step = { quorum: 1, approvers: approvers(1) };
  assert.equal(evaluateStep(step, [decide('A1', 'reject')]), 'failed');
});

test('1 of 3: any single approve -> passed immediately', () => {
  const step = { quorum: 1, approvers: approvers(3) };
  assert.equal(evaluateStep(step, [decide('A2', 'approve')]), 'passed');
});

test('1 of 3: two rejects still waiting (third could still approve)', () => {
  const step = { quorum: 1, approvers: approvers(3) };
  assert.equal(evaluateStep(step, [decide('A1', 'reject'), decide('A2', 'reject')]), 'waiting');
});

test('1 of 3: all three reject -> failed', () => {
  const step = { quorum: 1, approvers: approvers(3) };
  const decisions = [decide('A1', 'reject'), decide('A2', 'reject'), decide('A3', 'reject')];
  assert.equal(evaluateStep(step, decisions), 'failed');
});

test('2 of 3: two approvals -> passed', () => {
  const step = { quorum: 2, approvers: approvers(3) };
  assert.equal(evaluateStep(step, [decide('A1', 'approve'), decide('A2', 'approve')]), 'passed');
});

test('2 of 3: two rejections -> failed', () => {
  const step = { quorum: 2, approvers: approvers(3) };
  assert.equal(evaluateStep(step, [decide('A1', 'reject'), decide('A2', 'reject')]), 'failed');
});

test('2 of 3: one approve one reject -> still waiting', () => {
  const step = { quorum: 2, approvers: approvers(3) };
  assert.equal(evaluateStep(step, [decide('A1', 'approve'), decide('A2', 'reject')]), 'waiting');
});

test('3 of 3: first rejection already fails it (no room left)', () => {
  const step = { quorum: 3, approvers: approvers(3) };
  assert.equal(evaluateStep(step, [decide('A1', 'reject')]), 'failed');
});

test('3 of 3: needs every approver to approve', () => {
  const step = { quorum: 3, approvers: approvers(3) };
  const twoApproved = [decide('A1', 'approve'), decide('A2', 'approve')];
  assert.equal(evaluateStep(step, twoApproved), 'waiting');
  const allApproved = [...twoApproved, decide('A3', 'approve')];
  assert.equal(evaluateStep(step, allApproved), 'passed');
});

test('a recalled approval does not count', () => {
  const step = { quorum: 1, approvers: approvers(1) };
  assert.equal(evaluateStep(step, [decide('A1', 'approve', { recalled: true })]), 'waiting');
});

test('2 of 3: one recalled approval drops the count back below quorum', () => {
  const step = { quorum: 2, approvers: approvers(3) };
  const decisions = [decide('A1', 'approve'), decide('A2', 'approve', { recalled: true })];
  assert.equal(evaluateStep(step, decisions), 'waiting');
});
