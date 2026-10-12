import assert from "node:assert/strict";
import test from "node:test";
import { workspaceSectionFromHash, workspaceSectionHash, workspaceSelectionFromHash } from "./workspace-navigation.js";

test("workspace navigation accepts known sections and defaults unknown links to overview", () => {
  for (const section of ["overview", "actions", "instruments", "investors", "transactions", "audit", "system"] as const) {
    assert.equal(workspaceSectionFromHash(workspaceSectionHash(section)), section);
  }
  assert.equal(workspaceSectionFromHash(""), "overview");
  assert.equal(workspaceSectionFromHash("#unknown"), "overview");
  assert.equal(workspaceSectionFromHash("#ACTIONS"), "actions");
});

test("object bookmarks restore only a valid UUID in the matching workspace section", () => {
  const id = "464a832a-2c55-4e22-bb7a-6be93b429c78";
  const hash = workspaceSectionHash("actions", id);
  assert.equal(workspaceSectionFromHash(hash), "actions");
  assert.equal(workspaceSelectionFromHash(hash, "actions"), id);
  assert.equal(workspaceSelectionFromHash(hash, "investors"), null);
  assert.equal(workspaceSelectionFromHash("#actions?selected=invalid", "actions"), null);
  assert.equal(workspaceSectionHash("actions", "invalid"), "#actions");
});
