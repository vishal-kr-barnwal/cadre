import assert from "node:assert/strict";
import test from "node:test";
import { releaseChannel } from "../scripts/release-channel.js";

test("beta tags resolve to prereleases and can never select latest", () => {
  assert.deepEqual(releaseChannel("push", "beta-4.1.0", "4.1.0-beta.0"), { version: "4.1.0-beta.0", channel: "beta" });
  assert.deepEqual(releaseChannel("push", "beta-4.1.0-beta.2", "4.1.0-beta.2"), { version: "4.1.0-beta.2", channel: "beta" });
  for (const tag of ["beta-4.1.0-beta.01", "beta-04.1.0", "beta-4.1.0-rc.0", "beta-4.1.0\nchannel=latest", "release-4.1.0", "main"]) {
    assert.throws(() => releaseChannel("push", tag, "4.1.0-beta.0"), /Beta publication/);
  }
  assert.throws(() => releaseChannel("push", "beta-4.1.0", "4.1.0"), /Tag resolves/);
  assert.throws(() => releaseChannel("push", "beta-4.1.0-beta.1", "4.1.0-beta.0"), /Tag resolves/);
});

test("stable release tags retain latest and reject prerelease or unsupported events", () => {
  for (const tag of ["release-4.1.0", "v4.1.0", "4.1.0"]) {
    assert.deepEqual(releaseChannel("release", tag, "4.1.0"), { version: "4.1.0", channel: "latest" });
  }
  assert.throws(() => releaseChannel("release", "beta-4.1.0", "4.1.0-beta.0"), /Stable publication/);
  assert.throws(() => releaseChannel("release", "release-4.1.0-beta.0", "4.1.0-beta.0"), /Stable publication/);
  assert.throws(() => releaseChannel("release", "release-4.1.0", "4.0.0"), /Tag resolves/);
  assert.throws(() => releaseChannel("workflow_dispatch", "release-4.1.0", "4.1.0"), /Unsupported/);
});
