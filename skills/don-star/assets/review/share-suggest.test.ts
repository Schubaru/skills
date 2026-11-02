import assert from "node:assert/strict";
import type { Person } from "./model";
import { suggestPeople } from "./share-suggest";

const people: Person[] = [
  { email: "dolores.h@client.example", name: "Dolores C" },
  { email: "dave@client.example", name: "dave@client.example" },
  { email: "chrisp@client.example", name: "Chris Parisi" },
  { email: "bot@__DS_ADMIN_DOMAIN__", name: "/design-skill" },
];
const dir = new Map(people.map((p) => [p.email, p]));
const none = new Set<string>();

// "Do" finds a reviewer by name; "dol" by the address too.
assert.deepEqual(suggestPeople("Do", dir, none).map((p) => p.email), ["dolores.h@client.example"]);
assert.deepEqual(suggestPeople("dol", dir, none).map((p) => p.email), ["dolores.h@client.example"]);
// A surname start counts: "Par" → Chris Parisi.
assert.deepEqual(suggestPeople("par", dir, none).map((p) => p.email), ["chrisp@client.example"]);
// Someone already on the project still shows, flagged, in directory order.
assert.deepEqual(
  suggestPeople("d", dir, new Set(["dolores.h@client.example"])).map((p) => [p.email, p.onProject]),
  [["dolores.h@client.example", true], ["dave@client.example", false]],
);
// Agents never appear; an empty field, a list or a domain draft offers nothing.
assert.deepEqual(suggestPeople("des", dir, none).map((p) => p.email).includes("bot@__DS_ADMIN_DOMAIN__"), false);
assert.deepEqual(suggestPeople("", dir, none), []);
assert.deepEqual(suggestPeople("a@b.com, c", dir, none), []);
// The picked address closes the list.
assert.deepEqual(suggestPeople("dolores.h@client.example", dir, none), []);
console.log("share-suggest: 8 assertions pass");
