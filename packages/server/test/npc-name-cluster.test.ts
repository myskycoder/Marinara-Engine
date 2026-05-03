import test from "node:test";
import assert from "node:assert/strict";
import {
  findSingleNpcCandidateByNameCluster,
  isNpcNameStrictPrefixClusterMatch,
  isSameNpcName,
} from "@marinara-engine/shared";

test("isNpcNameStrictPrefixClusterMatch links short form to full Russian name", () => {
  assert.equal(isNpcNameStrictPrefixClusterMatch("Марина", "Марина Викторовна"), true);
  assert.equal(isNpcNameStrictPrefixClusterMatch("Марина Викторовна", "Марина"), true);
});

test("isNpcNameStrictPrefixClusterMatch rejects different patronymics", () => {
  assert.equal(isNpcNameStrictPrefixClusterMatch("Марина Викторовна", "Марина Петровна"), false);
});

test("isNpcNameStrictPrefixClusterMatch rejects unrelated names", () => {
  assert.equal(isNpcNameStrictPrefixClusterMatch("Марина", "Ольга"), false);
});

test("isNpcNameStrictPrefixClusterMatch is false when keys equal", () => {
  assert.equal(isNpcNameStrictPrefixClusterMatch("Марина", "марина"), false);
  assert.equal(isSameNpcName("Марина", "марина"), true);
});

test("findSingleNpcCandidateByNameCluster returns one NPC when short name matches", () => {
  const npcs = [{ name: "Марина Викторовна", id: "a" }];
  const hit = findSingleNpcCandidateByNameCluster("Марина", npcs);
  assert.equal(hit?.id, "a");
});

test("findSingleNpcCandidateByNameCluster returns undefined when two patronymics share first name", () => {
  const npcs = [
    { name: "Марина Викторовна", id: "1" },
    { name: "Марина Петровна", id: "2" },
  ];
  assert.equal(findSingleNpcCandidateByNameCluster("Марина", npcs), undefined);
});

test("findSingleNpcCandidateByNameCluster prefers exact match among prefix hits", () => {
  const npcs = [
    { name: "Марина", id: "short" },
    { name: "Марина Викторовна", id: "full" },
  ];
  const hit = findSingleNpcCandidateByNameCluster("Марина Викторовна", npcs);
  assert.equal(hit?.id, "full");
});
