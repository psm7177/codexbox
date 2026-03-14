import assert from "node:assert/strict";
import test from "node:test";
import { RestartCoordinator } from "../src/lifecycle/restart-coordinator.js";

test("restart coordinator exits once the last active turn finishes", async () => {
  const exitCodes: number[] = [];
  const coordinator = new RestartCoordinator({
    exitProcess: (code) => {
      exitCodes.push(code);
    },
  });

  assert.equal(coordinator.beginTurn(), true);
  const request = coordinator.requestRestart();
  assert.deepEqual(request, {
    alreadyPending: false,
    activeTurns: 1,
  });

  coordinator.maybeExit();
  assert.deepEqual(exitCodes, []);

  coordinator.endTurn();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(exitCodes, [75]);
});

test("restart coordinator rejects new turns after restart is pending", () => {
  const coordinator = new RestartCoordinator({
    exitProcess: () => {},
  });

  coordinator.requestRestart();

  assert.equal(coordinator.beginTurn(), false);
});
